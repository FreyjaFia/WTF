using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using WTF.Api.Common.DTOs;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record GetUnsyncedOrdersQuery(
    UnsyncedOrderStatusEnum? Status = null,
    Guid? CashierId = null,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    string? SearchTerm = null,
    string? SortBy = null,
    bool Descending = true,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResultDto<UnsyncedOrderDto>>;

public record GetUnsyncedOrderByIdQuery(Guid Id) : IRequest<UnsyncedOrderDetailDto?>;

public class GetUnsyncedOrdersHandler(WTFDbContext db) : IRequestHandler<GetUnsyncedOrdersQuery, PagedResultDto<UnsyncedOrderDto>>
{
    private const int MaxPageSize = 100;

    public async Task<PagedResultDto<UnsyncedOrderDto>> Handle(GetUnsyncedOrdersQuery request, CancellationToken cancellationToken)
    {
        var page = request.Page <= 0 ? 1 : request.Page;
        var pageSize = request.PageSize <= 0 ? 20 : Math.Min(request.PageSize, MaxPageSize);

        var query = db.UnsyncedOrders.AsNoTracking().AsQueryable();

        if (request.Status.HasValue)
        {
            var status = (byte)request.Status.Value;
            query = query.Where(u => u.StatusId == status);
        }

        if (request.CashierId.HasValue)
        {
            query = query.Where(u => u.CashierUserId == request.CashierId.Value);
        }

        if (request.FromDate.HasValue)
        {
            var from = DateTime.SpecifyKind(request.FromDate.Value, DateTimeKind.Utc);
            query = query.Where(u => u.ReceivedAt >= from);
        }

        if (request.ToDate.HasValue)
        {
            var to = DateTime.SpecifyKind(request.ToDate.Value, DateTimeKind.Utc);
            query = query.Where(u => u.ReceivedAt <= to);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var term = request.SearchTerm.Trim().ToLower();
            query = query.Where(u => u.OfflineLocalId.ToLower().Contains(term) || u.ErrorText.ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<UnsyncedOrderDto>([], page, pageSize, 0);
        }

        var ordered = Sort(query, request.SortBy, request.Descending);
        var rows = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var items = await UnsyncedOrderMapper.ToDtosAsync(db, rows, cancellationToken);
        return new PagedResultDto<UnsyncedOrderDto>(items, page, pageSize, totalCount);
    }

    private static IQueryable<UnsyncedOrder> Sort(IQueryable<UnsyncedOrder> query, string? sortBy, bool descending)
    {
        return (sortBy?.Trim().ToLowerInvariant()) switch
        {
            "queue" => descending ? query.OrderByDescending(u => u.OfflineLocalId) : query.OrderBy(u => u.OfflineLocalId),
            "cashier" => descending
                ? query.OrderByDescending(u => u.CashierUser.FirstName).ThenByDescending(u => u.CashierUser.LastName)
                : query.OrderBy(u => u.CashierUser.FirstName).ThenBy(u => u.CashierUser.LastName),
            "total" => descending ? query.OrderByDescending(u => u.QuotedTotal) : query.OrderBy(u => u.QuotedTotal),
            "error" => descending ? query.OrderByDescending(u => u.ErrorText) : query.OrderBy(u => u.ErrorText),
            "date" => descending ? query.OrderByDescending(u => u.DeviceCreatedAt ?? u.ReceivedAt) : query.OrderBy(u => u.DeviceCreatedAt ?? u.ReceivedAt),
            _ => descending ? query.OrderByDescending(u => u.ReceivedAt) : query.OrderBy(u => u.ReceivedAt),
        };
    }
}

public class GetUnsyncedOrderByIdHandler(WTFDbContext db) : IRequestHandler<GetUnsyncedOrderByIdQuery, UnsyncedOrderDetailDto?>
{
    public async Task<UnsyncedOrderDetailDto?> Handle(GetUnsyncedOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var row = await db.UnsyncedOrders.AsNoTracking().FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        return row is null ? null : await UnsyncedOrderMapper.ToDetailAsync(db, row, cancellationToken);
    }
}

internal static class UnsyncedOrderMapper
{
    public static CreateOrderCommand? ReadOrder(UnsyncedOrder row)
    {
        try
        {
            return JsonSerializer.Deserialize<CreateOrderCommand>(row.QuotedOrderJson, UnsyncedOrderRecorder.JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static async Task<List<UnsyncedOrderDto>> ToDtosAsync(WTFDbContext db, List<UnsyncedOrder> rows, CancellationToken cancellationToken)
    {
        var names = await UserNamesAsync(db, rows, cancellationToken);
        return [.. rows.Select(row => ToDto(row, names, ReadOrder(row)?.Items.Count ?? 0))];
    }

    public static async Task<UnsyncedOrderDetailDto> ToDetailAsync(WTFDbContext db, UnsyncedOrder row, CancellationToken cancellationToken)
    {
        var names = await UserNamesAsync(db, [row], cancellationToken);
        var order = ReadOrder(row);
        if (order is null)
        {
            return new UnsyncedOrderDetailDto(ToDto(row, names, 0), [], null, null, null, null, null, null);
        }

        var productIds = order.Items.Select(i => i.ProductId)
            .Concat(order.Items.SelectMany(i => i.AddOns.Select(a => a.ProductId)))
            .Distinct()
            .ToList();
        var productNames = await db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, cancellationToken);

        UnsyncedOrderLineDto ToLine(OrderItemRequestDto item) => new(
            item.ProductId,
            productNames.GetValueOrDefault(item.ProductId),
            item.Quantity,
            item.QuotedPrice,
            item.SpecialInstructions,
            [.. item.AddOns.Select(ToLine)]);

        return new UnsyncedOrderDetailDto(
            ToDto(row, names, order.Items.Count),
            [.. order.Items.Select(ToLine)],
            order.PaymentMethod,
            order.AmountReceived,
            order.ChangeAmount,
            order.Tips,
            order.Note,
            order.SpecialInstructions);
    }

    public static async Task<Dictionary<Guid, string>> UserNamesAsync(WTFDbContext db, IEnumerable<UnsyncedOrder> rows, CancellationToken cancellationToken)
    {
        var ids = rows.Select(r => r.CashierUserId)
            .Concat(rows.Where(r => r.ResolvedBy.HasValue).Select(r => r.ResolvedBy!.Value))
            .Distinct()
            .ToList();
        return await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => (u.FirstName + " " + u.LastName).Trim(), cancellationToken);
    }

    public static UnsyncedOrderDto ToDto(UnsyncedOrder row, Dictionary<Guid, string> names, int lineCount)
    {
        return new UnsyncedOrderDto(
            row.Id,
            row.OfflineLocalId,
            row.ErrorText,
            row.ErrorCode,
            row.CashierUserId,
            names.GetValueOrDefault(row.CashierUserId),
            row.DeviceCreatedAt,
            row.ReceivedAt,
            row.QuotedTotal,
            (UnsyncedOrderStatusEnum)row.StatusId,
            row.Resolution.HasValue ? (UnsyncedOrderResolutionEnum)row.Resolution.Value : null,
            row.ResolvedBy.HasValue ? names.GetValueOrDefault(row.ResolvedBy.Value) : null,
            row.ResolvedAt,
            row.DiscardReason,
            row.ResultingOrderId,
            lineCount);
    }
}
