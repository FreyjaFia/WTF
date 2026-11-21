using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Kitchen.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Kitchen;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Kitchen;

internal static class KitchenBoardLoader
{
    private const string TemperatureType = "Temperature";

    public static async Task<TimeZoneInfo> ShopTimeZoneAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var zone = await db.TenantSettings.AsNoTracking().Select(s => s.TimeZone).FirstOrDefaultAsync(cancellationToken);
        return RequestTimeZone.Resolve(zone);
    }

    public static async Task<List<KitchenOrderDto>> MapAsync(
        WTFDbContext db, IQueryable<Order> query, TimeZoneInfo timeZone, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var orders = await query
            .Include(o => o.Customer)
            .Include(o => o.Branch)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .AsNoTrackingWithIdentityResolution()
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        var parentProductIds = orders
            .SelectMany(o => o.OrderItems.Where(i => i.ParentOrderItemId == null).Select(i => i.ProductId))
            .Distinct()
            .ToList();

        var addOnTypes = await db.ProductAddOns
            .AsNoTracking()
            .Where(pa => parentProductIds.Contains(pa.ProductId) && pa.AddOnType != null)
            .Select(pa => new { pa.ProductId, pa.AddOnId, TypeName = pa.AddOnType!.Name })
            .ToListAsync(cancellationToken);
        var typeOf = addOnTypes
            .GroupBy(x => (x.ProductId, x.AddOnId))
            .ToDictionary(g => g.Key, g => g.First().TypeName);

        return [.. orders.Select(o => ToDto(o, typeOf, timeZone, nowUtc))];
    }

    private static KitchenOrderDto ToDto(
        Order order, IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), string> typeOf, TimeZoneInfo timeZone, DateTime nowUtc)
    {
        var state = (byte)(order.KitchenStatus ?? (byte)KitchenState.New);
        var items = order.OrderItems.ToList();

        var lines = items
            .Where(i => i.ParentOrderItemId == null)
            .OrderBy(i => i.SortOrder)
            .ThenBy(i => i.Id)
            .Select(parent => new KitchenLineDto(
                parent.Product.Name,
                parent.Quantity,
                Clean(parent.SpecialInstructions),
                [.. items
                    .Where(c => c.ParentOrderItemId == parent.Id)
                    .OrderBy(c => c.SortOrder)
                    .ThenBy(c => c.Id)
                    .Select(c =>
                    {
                        typeOf.TryGetValue((parent.ProductId, c.ProductId), out var typeName);
                        return new KitchenAddOnDto(
                            c.Product.Name,
                            c.Quantity,
                            Clean(c.SpecialInstructions),
                            typeName,
                            string.Equals(typeName, TemperatureType, StringComparison.OrdinalIgnoreCase));
                    })]))
            .ToList();

        var dismissed = order.KitchenDismissedAt.HasValue;
        var onBoard = KitchenBoardRules.IsOnBoard(order.StatusId, state);
        var firstName = order.Customer?.FirstName?.Trim();

        return new KitchenOrderDto(
            order.Id,
            order.OrderNumber,
            DateTime.SpecifyKind(order.CreatedAt, DateTimeKind.Utc),
            state,
            Utc(order.KitchenStartedAt),
            Utc(order.ReadyAt),
            Utc(order.KitchenServedAt),
            (OrderSourceEnum)order.Source,
            order.FulfillmentType.HasValue ? (FulfillmentTypeEnum)order.FulfillmentType.Value : null,
            string.IsNullOrEmpty(firstName) ? null : firstName,
            Clean(order.SpecialInstructions),
            lines,
            order.KitchenChangeNote,
            order.KitchenChangeKind,
            onBoard && KitchenBoardRules.IsStale(order.CreatedAt, nowUtc, timeZone),
            KitchenBoardRules.IsStopMakingCard(order.StatusId, state, dismissed),
            order.Branch?.Code);
    }

    private static DateTime? Utc(DateTime? value) => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
