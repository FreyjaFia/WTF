using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record GetOfflineSyncPolicyQuery : IRequest<OfflineSyncPolicyDto>;

public record UpdateOfflineSyncPolicyCommand(
    List<OfflineSyncCodeModeDto> Codes,
    decimal PriceTolerance,
    bool AutoApproveNotes,
    int AgedAfterDays) : IRequest<OfflineSyncPolicyDto>;

internal static class OfflineSyncPolicyStore
{
    public static async Task<OfflineSyncPolicySnapshot> LoadSnapshotAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.OfflineSyncPolicies.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return row is null ? OfflineSyncPolicySnapshot.Default : ToSnapshot(row);
    }

    public static OfflineSyncPolicySnapshot ToSnapshot(OfflineSyncPolicy row)
    {
        return new OfflineSyncPolicySnapshot(
            OfflineSyncPolicyRules.ConfigurableCodes.Where(code => ModeOf(row, code) == ReviewSeverityEnum.Note).ToHashSet(StringComparer.Ordinal),
            row.PriceTolerance,
            row.AutoApproveNotes,
            row.AgedAfterDays);
    }

    public static OfflineSyncPolicyDto ToDto(OfflineSyncPolicy? row)
    {
        var snapshot = row is null ? OfflineSyncPolicySnapshot.Default : ToSnapshot(row);
        return new OfflineSyncPolicyDto(
            [.. OfflineSyncPolicyRules.ConfigurableCodes.Select(code => new OfflineSyncCodeModeDto(
                code, (snapshot.NoteCodes.Contains(code) ? ReviewSeverityEnum.Note : ReviewSeverityEnum.Hold).ToString()))],
            snapshot.PriceTolerance,
            snapshot.AutoApproveNotes,
            snapshot.AgedAfterDays,
            row?.UpdatedAt);
    }

    public static ReviewSeverityEnum ModeOf(OfflineSyncPolicy row, string code)
    {
        return (ReviewSeverityEnum)(code switch
        {
            OfflineReasonCodes.PriceChanged => row.PriceChangedMode,
            OfflineReasonCodes.AddOnPriceChanged => row.AddOnPriceChangedMode,
            OfflineReasonCodes.ProductInactive => row.ProductInactiveMode,
            OfflineReasonCodes.BundleChanged => row.BundleChangedMode,
            OfflineReasonCodes.CustomerInactive => row.CustomerInactiveMode,
            OfflineReasonCodes.PromotionEnded => row.PromotionEndedMode,
            OfflineReasonCodes.UnknownProduct => row.UnknownProductMode,
            _ => (byte)ReviewSeverityEnum.Hold
        });
    }

    public static void SetMode(OfflineSyncPolicy row, string code, ReviewSeverityEnum mode)
    {
        var value = (byte)mode;
        switch (code)
        {
            case OfflineReasonCodes.PriceChanged:
                row.PriceChangedMode = value;
                break;
            case OfflineReasonCodes.AddOnPriceChanged:
                row.AddOnPriceChangedMode = value;
                break;
            case OfflineReasonCodes.ProductInactive:
                row.ProductInactiveMode = value;
                break;
            case OfflineReasonCodes.BundleChanged:
                row.BundleChangedMode = value;
                break;
            case OfflineReasonCodes.CustomerInactive:
                row.CustomerInactiveMode = value;
                break;
            case OfflineReasonCodes.PromotionEnded:
                row.PromotionEndedMode = value;
                break;
            case OfflineReasonCodes.UnknownProduct:
                row.UnknownProductMode = value;
                break;
        }
    }
}

public class GetOfflineSyncPolicyHandler(WTFDbContext db) : IRequestHandler<GetOfflineSyncPolicyQuery, OfflineSyncPolicyDto>
{
    public async Task<OfflineSyncPolicyDto> Handle(GetOfflineSyncPolicyQuery request, CancellationToken cancellationToken)
    {
        var row = await db.OfflineSyncPolicies.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return OfflineSyncPolicyStore.ToDto(row);
    }
}

public class UpdateOfflineSyncPolicyHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdateOfflineSyncPolicyCommand, OfflineSyncPolicyDto>
{
    public async Task<OfflineSyncPolicyDto> Handle(UpdateOfflineSyncPolicyCommand request, CancellationToken cancellationToken)
    {
        var modes = ParseModes(request.Codes);
        if (!OfflineSyncPolicyRules.IsValidTolerance(request.PriceTolerance) || decimal.Round(request.PriceTolerance, 2) != request.PriceTolerance)
        {
            throw new InvalidOperationException($"The price tolerance must be between 0 and {OfflineSyncPolicyRules.MaxPriceTolerance:0} pesos, with at most 2 decimals.");
        }

        if (!OfflineSyncPolicyRules.IsValidAgedAfterDays(request.AgedAfterDays))
        {
            throw new InvalidOperationException($"Flag held orders after {OfflineSyncPolicyRules.MinAgedAfterDays} to {OfflineSyncPolicyRules.MaxAgedAfterDays} days.");
        }

        var tenantId = db.StampTenantId ?? throw new InvalidOperationException("Sign in to a shop first.");
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var row = await db.OfflineSyncPolicies.FirstOrDefaultAsync(cancellationToken);
        var before = OfflineSyncPolicyStore.ToDto(row);
        if (row is null)
        {
            var hold = (byte)ReviewSeverityEnum.Hold;
            row = new OfflineSyncPolicy
            {
                TenantId = tenantId,
                PriceChangedMode = hold,
                AddOnPriceChangedMode = hold,
                ProductInactiveMode = hold,
                BundleChangedMode = hold,
                CustomerInactiveMode = hold,
                PromotionEndedMode = hold,
                UnknownProductMode = hold
            };
            db.OfflineSyncPolicies.Add(row);
        }

        foreach (var (code, mode) in modes)
        {
            OfflineSyncPolicyStore.SetMode(row, code, mode);
        }

        row.PriceTolerance = request.PriceTolerance;
        row.AutoApproveNotes = request.AutoApproveNotes;
        row.AgedAfterDays = request.AgedAfterDays;
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        var after = OfflineSyncPolicyStore.ToDto(row);
        await auditService.LogAsync(
            action: AuditAction.OfflineSyncPolicyChanged,
            entityType: AuditEntityType.OfflineSyncPolicy,
            entityId: tenantId.ToString(),
            oldValues: before,
            newValues: after,
            userId: userId,
            cancellationToken: cancellationToken);

        return after;
    }

    private static Dictionary<string, ReviewSeverityEnum> ParseModes(List<OfflineSyncCodeModeDto>? codes)
    {
        var modes = new Dictionary<string, ReviewSeverityEnum>(StringComparer.Ordinal);
        foreach (var entry in codes ?? [])
        {
            if (!OfflineSyncPolicyRules.IsConfigurable(entry.Code))
            {
                throw new InvalidOperationException($"'{entry.Code}' cannot be changed in the policy.");
            }

            if (!Enum.TryParse<ReviewSeverityEnum>(entry.Mode, true, out var mode) || !Enum.IsDefined(mode))
            {
                throw new InvalidOperationException($"'{entry.Mode}' is not a mode for {entry.Code}. Use Hold or Note.");
            }

            if (!modes.TryAdd(entry.Code, mode))
            {
                throw new InvalidOperationException($"{entry.Code} is listed twice.");
            }
        }

        return modes;
    }
}
