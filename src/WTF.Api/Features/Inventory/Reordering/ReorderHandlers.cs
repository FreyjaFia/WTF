using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Reordering;

public record GetReorderListQuery(int UsageDays = 28) : IRequest<ReorderListDto>;

public record GetParLevelsQuery : IRequest<List<ParLevelRowDto>>;

public record SetParLevelCommand(Guid ItemId, decimal? ParLevel) : IRequest<ParLevelRowDto?>;

public class GetReorderListHandler(WTFDbContext db) : IRequestHandler<GetReorderListQuery, ReorderListDto>
{
    private const string NoSupplierName = "No supplier set";

    public async Task<ReorderListDto> Handle(GetReorderListQuery request, CancellationToken cancellationToken)
    {
        var days = Math.Clamp(request.UsageDays, 7, 90);
        var items = await db.Items
            .AsNoTracking()
            .Where(i => i.IsActive)
            .Select(i => new { i.Id, i.Name, i.UnitName, i.CurrentQuantity, i.ParLevel })
            .ToListAsync(cancellationToken);

        var withPar = items.Where(i => i.ParLevel.HasValue).ToList();
        var ids = withPar.Select(i => i.Id).ToList();
        var since = DateTime.UtcNow.AddDays(-days);

        var usage = await db.StockMovements
            .AsNoTracking()
            .Where(m => ids.Contains(m.ItemId) && m.CreatedAt >= since
                && (m.MovementType == StockMovementTypes.Sale || m.MovementType == StockMovementTypes.SaleVoid))
            .GroupBy(m => m.ItemId)
            .Select(g => new { ItemId = g.Key, Net = g.Sum(m => -m.QuantityDelta) })
            .ToDictionaryAsync(x => x.ItemId, x => x.Net, cancellationToken);

        var preferred = await db.ItemSuppliers
            .AsNoTracking()
            .Where(l => ids.Contains(l.ItemId) && l.IsPreferred)
            .Select(l => new
            {
                l.ItemId,
                l.SupplierId,
                SupplierName = l.Supplier.Name,
                l.Supplier.LeadTimeDays,
                l.PackName,
                l.UnitsPerPack,
                l.PackPrice
            })
            .ToDictionaryAsync(l => l.ItemId, cancellationToken);

        var onOrder = await ReorderOnOrder.LoadAsync(db, ids, cancellationToken);

        var lines = new List<(Guid? SupplierId, string SupplierName, int? LeadTimeDays, ReorderLineDto Line)>();
        foreach (var item in withPar)
        {
            var order = onOrder.GetValueOrDefault(item.Id);
            if (!ReorderRules.IsBelowPar(item.ParLevel, item.CurrentQuantity, order))
            {
                continue;
            }

            preferred.TryGetValue(item.Id, out var link);
            var suggestion = ReorderRules.Suggest(item.ParLevel, item.CurrentQuantity, order, link?.UnitsPerPack);
            if (suggestion is null)
            {
                continue;
            }

            var average = ReorderRules.AverageDailyUsage(usage.GetValueOrDefault(item.Id), days);
            decimal? estimate = suggestion.Packs.HasValue && link?.PackPrice is { } price
                ? PurchasingRules.LineTotal(suggestion.Packs.Value, price)
                : null;

            lines.Add((link?.SupplierId, link?.SupplierName ?? NoSupplierName, link?.LeadTimeDays, new ReorderLineDto(
                item.Id, item.Name, item.UnitName, item.CurrentQuantity, item.ParLevel!.Value, order,
                ReorderRules.DaysOfCover(item.CurrentQuantity, average), suggestion.Units, suggestion.Packs, link?.PackName,
                link?.UnitsPerPack, link?.PackPrice, estimate)));
        }

        var groups = lines
            .GroupBy(l => new { l.SupplierId, l.SupplierName, l.LeadTimeDays })
            .OrderBy(g => g.Key.SupplierId is null ? 1 : 0)
            .ThenBy(g => g.Key.SupplierName)
            .Select(g =>
            {
                var groupLines = g.Select(l => l.Line).OrderBy(l => l.ItemName).ToList();
                var known = groupLines.Where(l => l.EstimatedCost.HasValue).ToList();
                return new ReorderGroupDto(
                    g.Key.SupplierId, g.Key.SupplierName, g.Key.LeadTimeDays,
                    known.Count == 0 ? null : known.Sum(l => l.EstimatedCost!.Value), groupLines);
            })
            .ToList();

        return new ReorderListDto(groups, lines.Count, items.Count - withPar.Count);
    }
}

public class GetParLevelsHandler(WTFDbContext db) : IRequestHandler<GetParLevelsQuery, List<ParLevelRowDto>>
{
    public Task<List<ParLevelRowDto>> Handle(GetParLevelsQuery request, CancellationToken cancellationToken) =>
        db.Items
            .AsNoTracking()
            .Where(i => i.IsActive)
            .OrderBy(i => i.Name)
            .Select(i => new ParLevelRowDto(i.Id, i.Name, i.UnitName, i.CurrentQuantity, i.ParLevel))
            .ToListAsync(cancellationToken);
}

public class SetParLevelHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetParLevelCommand, ParLevelRowDto?>
{
    public async Task<ParLevelRowDto?> Handle(SetParLevelCommand request, CancellationToken cancellationToken)
    {
        if (request.ParLevel is < 0 or > 999999.999m)
        {
            throw new InvalidOperationException("Par level must be zero or more.");
        }

        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var old = item.ParLevel;
        if (old != request.ParLevel)
        {
            item.ParLevel = request.ParLevel;
            item.UpdatedAt = DateTime.UtcNow;
            item.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);

            await auditService.LogAsync(
                AuditAction.ItemParLevelChanged,
                AuditEntityType.Item,
                item.Id.ToString(),
                oldValues: new { item.Name, ParLevel = old },
                newValues: new { item.Name, item.ParLevel },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return new ParLevelRowDto(item.Id, item.Name, item.UnitName, item.CurrentQuantity, item.ParLevel);
    }
}

internal static class ReorderOnOrder
{
    public static Task<Dictionary<Guid, decimal>> LoadAsync(WTFDbContext db, List<Guid> itemIds, CancellationToken cancellationToken) =>
        Task.FromResult(new Dictionary<Guid, decimal>());
}
