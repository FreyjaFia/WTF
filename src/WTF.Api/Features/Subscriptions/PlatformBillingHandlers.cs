using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Platform;
using WTF.Api.Services;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Subscriptions;

public record PlanDto(int Id, string Code, string Name, decimal MonthlyPrice, string[] Features, int? MaxUsers, bool IsActive);

public record TenantSubscriptionDto(
    Guid TenantId,
    string TenantName,
    byte TenantStatus,
    int PlanId,
    string PlanName,
    decimal MonthlyPrice,
    DateTime PeriodStart,
    DateTime PeriodEnd,
    int GraceDays,
    decimal DiscountPercent,
    string? Notes,
    DateTime AccessUntil,
    string Warning,
    int DaysLeft,
    List<TenantInvoiceDto> Invoices);

internal static class PlatformBilling
{
    public static PlanDto ToDto(Plan p) =>
        new(p.Id, p.Code, p.Name, p.MonthlyPrice, SubscriptionStateLoader.SplitFeatures(p.Features), p.MaxUsers, p.IsActive);

    public static async Task<TenantSubscriptionDto> BuildAsync(WTFDbContext db, Guid tenantId, DateTime now, CancellationToken cancellationToken)
    {
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        var sub = await db.TenantSubscriptions.AsNoTracking().Include(s => s.Plan)
            .FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken)
            ?? throw new KeyNotFoundException("This shop has no subscription yet.");

        var plans = await db.Plans.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);
        var invoices = await db.TenantInvoices.AsNoTracking()
            .Where(i => i.TenantId == tenantId)
            .OrderByDescending(i => i.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);

        return new TenantSubscriptionDto(
            tenantId,
            tenant.Name,
            tenant.Status,
            sub.PlanId,
            sub.Plan.Name,
            sub.Plan.MonthlyPrice,
            sub.CurrentPeriodStart,
            sub.CurrentPeriodEnd,
            sub.GraceDays,
            sub.DiscountPercent,
            sub.Notes,
            SubscriptionRules.AccessUntil(sub.CurrentPeriodEnd, sub.GraceDays),
            SubscriptionNames.Warning(SubscriptionRules.WarningLevel(sub.CurrentPeriodEnd, sub.GraceDays, now)),
            SubscriptionRules.DaysLeft(sub.CurrentPeriodEnd, now),
            [.. invoices.Select(i => InvoiceMapping.ToDto(i, plans))]);
    }
}

public record GetPlansQuery : IRequest<List<PlanDto>>;

public class GetPlansHandler(WTFDbContext db) : IRequestHandler<GetPlansQuery, List<PlanDto>>
{
    public async Task<List<PlanDto>> Handle(GetPlansQuery request, CancellationToken cancellationToken)
    {
        var plans = await db.Plans.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(cancellationToken);
        return [.. plans.Select(PlatformBilling.ToDto)];
    }
}

public record UpdatePlanCommand(int Id, string Name, decimal MonthlyPrice, string[] Features, int? MaxUsers, bool IsActive) : IRequest<PlanDto>;

public class UpdatePlanHandler(WTFDbContext db, IPlatformAuditService audit, ITenantFeatures tenantFeatures) : IRequestHandler<UpdatePlanCommand, PlanDto>
{
    public async Task<PlanDto> Handle(UpdatePlanCommand request, CancellationToken cancellationToken)
    {
        var plan = await db.Plans.FirstOrDefaultAsync(p => p.Id == request.Id, cancellationToken)
            ?? throw new KeyNotFoundException("Plan not found.");

        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 60)
        {
            throw new InvalidOperationException("Plan name is required (60 characters at most).");
        }

        if (request.MonthlyPrice is < 0 or > 10_000_000)
        {
            throw new InvalidOperationException("Price must be between 0 and 10,000,000.");
        }

        if (request.MaxUsers is < 1)
        {
            throw new InvalidOperationException("Maximum users must be at least 1, or empty for no limit.");
        }

        var features = string.Join(',', (request.Features ?? []).Select(f => f.Trim().ToLowerInvariant()).Where(f => f.Length > 0).Distinct());
        if (features.Length > 500)
        {
            throw new InvalidOperationException("Too many features.");
        }

        var summary = $"{plan.Name}: {plan.MonthlyPrice:0.00} -> {request.MonthlyPrice:0.00}; features '{plan.Features}' -> '{features}'; active {plan.IsActive} -> {request.IsActive}";
        plan.Name = name;
        plan.MonthlyPrice = request.MonthlyPrice;
        plan.Features = features;
        plan.MaxUsers = request.MaxUsers;
        plan.IsActive = request.IsActive;
        await db.SaveChangesAsync(cancellationToken);
        tenantFeatures.Forget();

        await audit.LogAsync(PlatformActions.PlanUpdated, null, summary, cancellationToken: cancellationToken);
        return PlatformBilling.ToDto(plan);
    }
}

public record GetTenantSubscriptionQuery(Guid TenantId) : IRequest<TenantSubscriptionDto>;

public class GetTenantSubscriptionHandler(WTFDbContext db, TimeProvider clock) : IRequestHandler<GetTenantSubscriptionQuery, TenantSubscriptionDto>
{
    public Task<TenantSubscriptionDto> Handle(GetTenantSubscriptionQuery request, CancellationToken cancellationToken) =>
        PlatformBilling.BuildAsync(db, request.TenantId, clock.GetUtcNow().UtcDateTime, cancellationToken);
}

public record SetTenantSubscriptionCommand(
    Guid TenantId,
    int PlanId,
    DateTime? PeriodEnd,
    int GraceDays,
    decimal DiscountPercent,
    string? Notes) : IRequest<TenantSubscriptionDto>;

public class SetTenantSubscriptionHandler(WTFDbContext db, IPlatformAuditService audit, TenantStatusCache statusCache, ITenantFeatures tenantFeatures, TimeProvider clock)
    : IRequestHandler<SetTenantSubscriptionCommand, TenantSubscriptionDto>
{
    public async Task<TenantSubscriptionDto> Handle(SetTenantSubscriptionCommand request, CancellationToken cancellationToken)
    {
        var sub = await db.TenantSubscriptions.FirstOrDefaultAsync(s => s.TenantId == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("This shop has no subscription yet.");

        if (!await db.Plans.AnyAsync(p => p.Id == request.PlanId, cancellationToken))
        {
            throw new InvalidOperationException("Plan not found.");
        }

        if (request.GraceDays is < 0 or > 90)
        {
            throw new InvalidOperationException("Grace days must be 0 to 90.");
        }

        if (request.DiscountPercent is < 0 or > 100)
        {
            throw new InvalidOperationException("Discount must be 0 to 100 percent.");
        }

        if (request.Notes is { Length: > 500 })
        {
            throw new InvalidOperationException("Notes are too long (500 characters at most).");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var periodEnd = request.PeriodEnd?.ToUniversalTime() ?? sub.CurrentPeriodEnd;
        if (periodEnd <= sub.CurrentPeriodStart)
        {
            throw new InvalidOperationException("The period must end after it starts.");
        }

        var summary = $"plan {sub.PlanId} -> {request.PlanId}; period end {sub.CurrentPeriodEnd:yyyy-MM-dd} -> {periodEnd:yyyy-MM-dd}; grace {sub.GraceDays} -> {request.GraceDays}; discount {sub.DiscountPercent} -> {request.DiscountPercent}";
        sub.PlanId = request.PlanId;
        sub.CurrentPeriodEnd = periodEnd;
        sub.GraceDays = request.GraceDays;
        sub.DiscountPercent = request.DiscountPercent;
        sub.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        sub.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        statusCache.Forget(request.TenantId);
        tenantFeatures.Forget();

        await audit.LogAsync(PlatformActions.SubscriptionUpdated, request.TenantId, summary, cancellationToken: cancellationToken);
        return await PlatformBilling.BuildAsync(db, request.TenantId, now, cancellationToken);
    }
}

public record CreateInvoiceCommand(Guid TenantId, int Months, string? Reference, DateTime? DueDate, string? Notes) : IRequest<TenantInvoiceDto>;

public class CreateInvoiceHandler(WTFDbContext db, IPlatformAuditService audit, TimeProvider clock) : IRequestHandler<CreateInvoiceCommand, TenantInvoiceDto>
{
    public async Task<TenantInvoiceDto> Handle(CreateInvoiceCommand request, CancellationToken cancellationToken)
    {
        if (request.Months is < 1 or > 60)
        {
            throw new InvalidOperationException("Months must be 1 to 60.");
        }

        var sub = await db.TenantSubscriptions.AsNoTracking().Include(s => s.Plan)
            .FirstOrDefaultAsync(s => s.TenantId == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("This shop has no subscription yet.");

        var now = clock.GetUtcNow().UtcDateTime;
        var (start, end) = SubscriptionRules.NextPeriod(sub.CurrentPeriodEnd, now, request.Months);

        var invoice = new TenantInvoice
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            PlanId = sub.PlanId,
            PeriodStart = start,
            PeriodEnd = end,
            Months = request.Months,
            Amount = SubscriptionRules.InvoiceAmount(sub.Plan.MonthlyPrice, request.Months, sub.DiscountPercent),
            Status = SubscriptionNames.InvoiceOpen,
            Reference = Clean(request.Reference, 100),
            DueDate = request.DueDate?.ToUniversalTime(),
            Notes = Clean(request.Notes, 500),
            CreatedAt = now
        };

        db.TenantInvoices.Add(invoice);
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync(
            PlatformActions.InvoiceCreated,
            request.TenantId,
            $"{sub.Plan.Name}, {request.Months} month(s), {invoice.Amount:0.00}.",
            cancellationToken: cancellationToken);

        return InvoiceMapping.ToDto(invoice, new Dictionary<int, string> { [sub.PlanId] = sub.Plan.Name });
    }

    internal static string? Clean(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > max)
        {
            throw new InvalidOperationException($"Text is too long ({max} characters at most).");
        }

        return trimmed;
    }
}

public record MarkInvoicePaidCommand(Guid InvoiceId, string? Reference) : IRequest<TenantSubscriptionDto>;

// Payment is the only thing that extends a shop: the period moves forward from the end of the paid time (or from today when the
// shop had lapsed), a trial shop becomes Active, and the device gets a new lease the next time it reaches the API.
public class MarkInvoicePaidHandler(WTFDbContext db, IPlatformAuditService audit, TenantStatusCache statusCache, TimeProvider clock)
    : IRequestHandler<MarkInvoicePaidCommand, TenantSubscriptionDto>
{
    public async Task<TenantSubscriptionDto> Handle(MarkInvoicePaidCommand request, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var invoice = await db.TenantInvoices.FirstOrDefaultAsync(i => i.Id == request.InvoiceId, cancellationToken)
            ?? throw new KeyNotFoundException("Invoice not found.");

        if (invoice.Status != SubscriptionNames.InvoiceOpen)
        {
            throw new InvalidOperationException($"This invoice is already {SubscriptionNames.InvoiceStatus(invoice.Status).ToLowerInvariant()}.");
        }

        // The first request to flip the invoice holds the row until it commits, so a second one at the same moment finds it no longer open.
        var claimed = await db.TenantInvoices
            .Where(i => i.Id == invoice.Id && i.Status == SubscriptionNames.InvoiceOpen)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.Status, SubscriptionNames.InvoicePaid), cancellationToken);
        if (claimed == 0)
        {
            throw new InvalidOperationException("This invoice is already paid.");
        }

        var sub = await db.TenantSubscriptions.FirstOrDefaultAsync(s => s.TenantId == invoice.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("This shop has no subscription yet.");

        var (start, end) = SubscriptionRules.NextPeriod(sub.CurrentPeriodEnd, now, invoice.Months);

        invoice.Status = SubscriptionNames.InvoicePaid;
        invoice.PaidAt = now;
        invoice.PeriodStart = start;
        invoice.PeriodEnd = end;
        invoice.Reference = CreateInvoiceHandler.Clean(request.Reference, 100) ?? invoice.Reference;

        sub.PlanId = invoice.PlanId;
        sub.CurrentPeriodStart = start;
        sub.CurrentPeriodEnd = end;
        sub.ReminderSentOn = null;
        sub.UpdatedAt = now;

        var tenant = await db.Tenants.FirstAsync(t => t.Id == invoice.TenantId, cancellationToken);
        if (tenant.Status == TenantAccess.Trial)
        {
            tenant.Status = TenantAccess.Active;
            tenant.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        statusCache.Forget(invoice.TenantId);

        await audit.LogAsync(
            PlatformActions.InvoicePaid,
            invoice.TenantId,
            $"Paid {invoice.Amount:0.00}; paid until {end:yyyy-MM-dd}.",
            cancellationToken: cancellationToken);

        return await PlatformBilling.BuildAsync(db, invoice.TenantId, now, cancellationToken);
    }
}

public record VoidInvoiceCommand(Guid InvoiceId) : IRequest<TenantSubscriptionDto>;

public class VoidInvoiceHandler(WTFDbContext db, IPlatformAuditService audit, TimeProvider clock) : IRequestHandler<VoidInvoiceCommand, TenantSubscriptionDto>
{
    public async Task<TenantSubscriptionDto> Handle(VoidInvoiceCommand request, CancellationToken cancellationToken)
    {
        var invoice = await db.TenantInvoices.FirstOrDefaultAsync(i => i.Id == request.InvoiceId, cancellationToken)
            ?? throw new KeyNotFoundException("Invoice not found.");

        if (invoice.Status != SubscriptionNames.InvoiceOpen)
        {
            throw new InvalidOperationException("Only an open invoice can be voided.");
        }

        invoice.Status = SubscriptionNames.InvoiceVoid;
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync(PlatformActions.InvoiceVoided, invoice.TenantId, $"Voided {invoice.Amount:0.00}.", cancellationToken: cancellationToken);
        return await PlatformBilling.BuildAsync(db, invoice.TenantId, clock.GetUtcNow().UtcDateTime, cancellationToken);
    }
}

public record GetTenantBrandQuery(Guid TenantId) : IRequest<BrandDto>;

public class GetTenantBrandHandler(WTFDbContext db) : IRequestHandler<GetTenantBrandQuery, BrandDto>
{
    public async Task<BrandDto> Handle(GetTenantBrandQuery request, CancellationToken cancellationToken)
    {
        db.UseTenant(request.TenantId);
        return await BrandDefaults.LoadAsync(db, request.TenantId, cancellationToken);
    }
}

public record SetTenantBrandCommand(Guid TenantId, BrandDto Brand) : IRequest<BrandDto>;

public class SetTenantBrandHandler(WTFDbContext db, IPlatformAuditService audit) : IRequestHandler<SetTenantBrandCommand, BrandDto>
{
    public async Task<BrandDto> Handle(SetTenantBrandCommand request, CancellationToken cancellationToken)
    {
        if (!await db.Tenants.AnyAsync(t => t.Id == request.TenantId, cancellationToken))
        {
            throw new KeyNotFoundException("Shop not found.");
        }

        db.UseTenant(request.TenantId);
        await BrandDefaults.SaveAsync(db, request.TenantId, request.Brand, cancellationToken);

        await audit.LogAsync(PlatformActions.BrandUpdated, request.TenantId, $"Brand set to '{request.Brand.ShopName}'.", cancellationToken: cancellationToken);
        return await BrandDefaults.LoadAsync(db, request.TenantId, cancellationToken);
    }
}
