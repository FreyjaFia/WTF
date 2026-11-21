using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public record SaveItemBranchSettingsCommand(Guid ItemId, List<ItemBranchSettingInputDto> Branches, bool KeepCosts) : IRequest<List<ItemBranchStockDto>?>;

public class SaveItemBranchSettingsHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<SaveItemBranchSettingsCommand, List<ItemBranchStockDto>?>
{
    private const decimal MaxQuantity = 999999.999m;
    private const decimal MaxCost = 999999.999999m;

    public async Task<List<ItemBranchStockDto>?> Handle(SaveItemBranchSettingsCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        if (request.Branches.Select(b => b.BranchId).Distinct().Count() != request.Branches.Count)
        {
            throw new InvalidOperationException("A branch can only be listed once.");
        }

        foreach (var input in request.Branches)
        {
            Validate(input);
        }

        var shopBranchIds = await BranchRules.AllOfShop(db).Select(b => b.Id).ToListAsync(cancellationToken);
        if (request.Branches.Any(b => !shopBranchIds.Contains(b.BranchId)))
        {
            throw new InvalidOperationException("One or more branches were not found.");
        }

        if (request.Branches.Any(b => !db.MayWriteToBranch(b.BranchId)))
        {
            throw new ForbiddenActionException("You can only change the stock settings of the branches you work in.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var rows = await db.ItemBranchStocks
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(s => s.ItemId == item.Id)
            .ToDictionaryAsync(s => s.BranchId, cancellationToken);
        var changes = new Dictionary<string, object>();

        foreach (var input in request.Branches)
        {
            if (!rows.TryGetValue(input.BranchId, out var row))
            {
                row = new ItemBranchStock { TenantId = item.TenantId, ItemId = item.Id, BranchId = input.BranchId, UpdatedAt = DateTime.UtcNow };
                db.ItemBranchStocks.Add(row);
                rows[input.BranchId] = row;
            }

            var cost = request.KeepCosts ? row.CostPrice : input.CostPrice;
            if (row.WarningQuantity == input.WarningQuantity
                && row.CriticalQuantity == input.CriticalQuantity
                && row.ParLevel == input.ParLevel
                && row.CostPrice == cost)
            {
                continue;
            }

            changes[input.BranchId.ToString()] = new
            {
                Old = new { row.WarningQuantity, row.CriticalQuantity, row.ParLevel, row.CostPrice },
                New = new { input.WarningQuantity, input.CriticalQuantity, input.ParLevel, CostPrice = cost }
            };

            row.WarningQuantity = input.WarningQuantity;
            row.CriticalQuantity = input.CriticalQuantity;
            row.ParLevel = input.ParLevel;
            row.CostPrice = cost;
            row.UpdatedAt = DateTime.UtcNow;
        }

        if (changes.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync(
                action: AuditAction.ItemUpdated,
                entityType: AuditEntityType.Item,
                entityId: item.Id.ToString(),
                oldValues: null,
                newValues: new { item.Name, BranchSettings = changes },
                userId: userId,
                cancellationToken: cancellationToken);
            await stockAlerts.EvaluateEverywhereAsync([item.Id], cancellationToken);
        }

        return await LoadAsync(db, item, cancellationToken);
    }

    public static async Task<List<ItemBranchStockDto>> LoadAsync(WTFDbContext db, Item item, CancellationToken cancellationToken)
    {
        // The settings of every branch the person may use, whichever one they are working in.
        var stocks = await db.ItemBranchStocks.AsNoTracking()
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(s => s.ItemId == item.Id && s.Branch.IsActive && (!db.BranchFilterEnabled || db.AllowedBranchIds.Contains(s.BranchId)))
            .Include(s => s.Branch)
            .ToListAsync(cancellationToken);

        return [.. ItemMapping.BranchStocks(item, stocks)];
    }

    private static void Validate(ItemBranchSettingInputDto input)
    {
        foreach (var level in new[] { input.WarningQuantity, input.CriticalQuantity, input.ParLevel })
        {
            if (level is < 0 or > MaxQuantity)
            {
                throw new InvalidOperationException("Levels must be zero or more.");
            }
        }

        if (input.CostPrice is < 0 or > MaxCost)
        {
            throw new InvalidOperationException("Cost must be zero or more.");
        }

        if (input.WarningQuantity is { } warning && input.CriticalQuantity is { } critical && critical > warning)
        {
            throw new InvalidOperationException("The critical level cannot be above the warning level.");
        }
    }
}

public record GetItemBranchSettingsQuery(Guid ItemId) : IRequest<List<ItemBranchStockDto>?>;

public class GetItemBranchSettingsHandler(WTFDbContext db) : IRequestHandler<GetItemBranchSettingsQuery, List<ItemBranchStockDto>?>
{
    public async Task<List<ItemBranchStockDto>?> Handle(GetItemBranchSettingsQuery request, CancellationToken cancellationToken)
    {
        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        return item is null ? null : await SaveItemBranchSettingsHandler.LoadAsync(db, item, cancellationToken);
    }
}
