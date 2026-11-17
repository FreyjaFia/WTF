using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Features.Platform;
using WTF.Api.Services;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Subscriptions;

public record PlanFeatureDto(string Key, string Label, string Description, string Group, string[] Needs);

public record LostFeatureDto(string Key, string Label, int? DataCount, string? DataLabel);

public record PlanChangePreviewDto(List<LostFeatureDto> LostFeatures);

internal static class PlanFeatureInput
{
    // Unknown words are refused (a typo must never silently remove a feature); missing "needs" are added; the result is
    // stored in catalog order.
    public static string Clean(IEnumerable<string>? requested)
    {
        var words = (requested ?? []).Select(f => f.Trim().ToLowerInvariant()).Where(f => f.Length > 0).Distinct().ToList();
        var unknown = PlanFeatures.Unknown(words);
        if (unknown.Count > 0)
        {
            throw new InvalidOperationException(
                $"Unknown feature{(unknown.Count > 1 ? "s" : string.Empty)}: {string.Join(", ", unknown)}. Valid features: {string.Join(", ", PlanFeatures.Gateable)}.");
        }

        return PlanFeatures.Serialize(words);
    }

    public static string ValidatedName(string? name, decimal monthlyPrice, int? maxUsers, int? maxBranches = null)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > 60)
        {
            throw new InvalidOperationException("Plan name is required (60 characters at most).");
        }

        if (monthlyPrice is < 0 or > 10_000_000)
        {
            throw new InvalidOperationException("Price must be between 0 and 10,000,000.");
        }

        if (maxUsers is < 1)
        {
            throw new InvalidOperationException("Maximum users must be at least 1, or empty for no limit.");
        }

        if (maxBranches is < 1)
        {
            throw new InvalidOperationException("Maximum branches must be at least 1, or empty for no limit.");
        }

        return trimmed;
    }

    public static string Diff(string? before, string after)
    {
        var was = PlanFeatures.Normalize(PlanFeatures.Split(before));
        var now = PlanFeatures.Normalize(PlanFeatures.Split(after));
        var added = now.Except(was).ToList();
        var removed = was.Except(now).ToList();
        if (added.Count == 0 && removed.Count == 0)
        {
            return "features unchanged";
        }

        return $"features +[{string.Join(",", added)}] -[{string.Join(",", removed)}]";
    }
}

public record GetPlanFeaturesQuery : IRequest<List<PlanFeatureDto>>;

public class GetPlanFeaturesHandler : IRequestHandler<GetPlanFeaturesQuery, List<PlanFeatureDto>>
{
    public Task<List<PlanFeatureDto>> Handle(GetPlanFeaturesQuery request, CancellationToken cancellationToken) =>
        Task.FromResult(PlanFeatureCatalog.Entries
            .Select(f => new PlanFeatureDto(f.Key, f.Label, f.Description, f.Group, [.. f.Needs]))
            .ToList());
}

public record CreatePlanCommand(string Code, string Name, decimal MonthlyPrice, string[] Features, int? MaxUsers, bool IsActive, int? MaxBranches = null) : IRequest<PlanDto>;

public partial class CreatePlanHandler(WTFDbContext db, IPlatformAuditService audit) : IRequestHandler<CreatePlanCommand, PlanDto>
{
    public async Task<PlanDto> Handle(CreatePlanCommand request, CancellationToken cancellationToken)
    {
        var code = request.Code?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!CodePattern().IsMatch(code))
        {
            throw new InvalidOperationException("Plan code is required: 1 to 30 lowercase letters, digits or hyphens.");
        }

        var name = PlanFeatureInput.ValidatedName(request.Name, request.MonthlyPrice, request.MaxUsers, request.MaxBranches);

        if (await db.Plans.AnyAsync(p => p.Code == code, cancellationToken))
        {
            throw new InvalidOperationException("A plan with that code already exists.");
        }

        var features = PlanFeatureInput.Clean(request.Features);
        var nextOrder = (await db.Plans.MaxAsync(p => (int?)p.SortOrder, cancellationToken) ?? 0) + 1;
        var plan = new Plan
        {
            Code = code,
            Name = name,
            MonthlyPrice = request.MonthlyPrice,
            Features = features,
            MaxUsers = request.MaxUsers,
            MaxBranches = request.MaxBranches,
            IsActive = request.IsActive,
            SortOrder = nextOrder
        };

        db.Plans.Add(plan);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            throw new InvalidOperationException("A plan with that code already exists.");
        }

        await audit.LogAsync(
            PlatformActions.PlanCreated,
            null,
            $"{plan.Name} ({plan.Code}): {plan.MonthlyPrice:0.00}; {PlanFeatureInput.Diff(null, features)}; active {plan.IsActive}",
            cancellationToken: cancellationToken);

        return PlatformBilling.ToDto(plan);
    }

    [GeneratedRegex("^[a-z0-9-]{1,30}$")]
    private static partial Regex CodePattern();
}

public record GetPlanChangePreviewQuery(Guid TenantId, int PlanId) : IRequest<PlanChangePreviewDto>;

// What a shop would lose if it moved to another plan: every feature it holds now that the new plan lacks, with how much of
// the shop's own data sits in it. Nothing is deleted by a downgrade; this is only the warning in the change-plan dialog.
public class GetPlanChangePreviewHandler(WTFDbContext db, TimeProvider clock) : IRequestHandler<GetPlanChangePreviewQuery, PlanChangePreviewDto>
{
    public async Task<PlanChangePreviewDto> Handle(GetPlanChangePreviewQuery request, CancellationToken cancellationToken)
    {
        var sub = await db.TenantSubscriptions.AsNoTracking().Include(s => s.Plan)
            .FirstOrDefaultAsync(s => s.TenantId == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("This shop has no subscription yet.");
        var next = await db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == request.PlanId, cancellationToken)
            ?? throw new KeyNotFoundException("Plan not found.");

        var current = PlanFeatures.Parse(sub.Plan.Features);
        var after = PlanFeatures.Parse(next.Features);
        var lost = new List<LostFeatureDto>();

        foreach (var feature in PlanFeatures.Catalog.Where(f => current.Contains(f.Key) && !after.Contains(f.Key)))
        {
            var (count, label) = await CountDataAsync(feature.Key, request.TenantId, cancellationToken);
            lost.Add(new LostFeatureDto(feature.Key, PlanFeatureCatalog.LabelOf(feature.Key), count > 0 ? count : null, count > 0 ? label : null));
        }

        return new PlanChangePreviewDto(lost);
    }

    private async Task<(int Count, string? Label)> CountDataAsync(string feature, Guid tenantId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return feature switch
        {
            PlanFeatures.Inventory => (await db.Items.AsNoTracking().IgnoreQueryFilters().CountAsync(i => i.TenantId == tenantId && i.IsActive, cancellationToken), "items"),
            PlanFeatures.Purchasing => (
                await db.Suppliers.AsNoTracking().IgnoreQueryFilters().CountAsync(s => s.TenantId == tenantId && s.IsActive, cancellationToken)
                + await db.PurchaseOrders.AsNoTracking().IgnoreQueryFilters().CountAsync(p => p.TenantId == tenantId, cancellationToken),
                "suppliers and purchase orders"),
            PlanFeatures.Expenses => (await db.Expenses.AsNoTracking().IgnoreQueryFilters().CountAsync(e => e.TenantId == tenantId && e.IsActive, cancellationToken), "expenses"),
            PlanFeatures.Promotions => (await db.Promotions.AsNoTracking().IgnoreQueryFilters().CountAsync(p => p.TenantId == tenantId && p.IsActive, cancellationToken), "promotions"),
            PlanFeatures.OrderLinks => (await db.ShortLinks.AsNoTracking().IgnoreQueryFilters()
                .CountAsync(l => l.TenantId == tenantId && l.RevokedAt == null && (l.ExpiresAt == null || l.ExpiresAt > now), cancellationToken), "active order links"),
            PlanFeatures.Chat => (await db.Conversations.AsNoTracking().IgnoreQueryFilters().CountAsync(c => c.TenantId == tenantId, cancellationToken), "chat conversations"),
            PlanFeatures.Audit => (await db.AuditLogs.AsNoTracking().IgnoreQueryFilters().CountAsync(a => a.TenantId == tenantId, cancellationToken), "audit entries"),
            PlanFeatures.CustomRoles => (await db.UserRoles.AsNoTracking().IgnoreQueryFilters().CountAsync(r => r.TenantId == tenantId && !r.IsSystem, cancellationToken), "custom roles"),
            _ => (0, null)
        };
    }
}
