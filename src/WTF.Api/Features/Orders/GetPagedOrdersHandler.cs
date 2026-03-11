using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public sealed record GetPagedOrdersQuery(
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null,
    bool ExcludeFinalized = false,
    string? SearchTerm = null,
    int Page = 1,
    int PageSize = 20) : IRequest<PagedResultDto<OrderDto>>;

public sealed class GetPagedOrdersHandler(WTFDbContext db)
    : IRequestHandler<GetPagedOrdersQuery, PagedResultDto<OrderDto>>
{
    public async Task<PagedResultDto<OrderDto>> Handle(GetPagedOrdersQuery request, CancellationToken cancellationToken)
    {
        var page = request.Page <= 0 ? 1 : request.Page;
        var pageSize = request.PageSize <= 0 ? 20 : Math.Min(request.PageSize, 100);

        var baseQuery = db.Orders.AsQueryable();

        if (request.CustomerId.HasValue)
        {
            baseQuery = baseQuery.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        if (request.Status != OrderStatusEnum.All)
        {
            baseQuery = baseQuery.Where(o => o.StatusId == (int)request.Status);
        }
        else if (request.ExcludeFinalized)
        {
            baseQuery = baseQuery.Where(o => o.StatusId != (int)OrderStatusEnum.Completed && o.StatusId != (int)OrderStatusEnum.Refunded);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var term = request.SearchTerm.Trim().ToLower();
            baseQuery = baseQuery.Where(o =>
                o.OrderNumber.ToString().Contains(term) ||
                (o.Customer != null &&
                    (
                        (o.Customer.FirstName + " " + o.Customer.LastName).ToLower().Contains(term) ||
                        (o.Customer.LastName + " " + o.Customer.FirstName).ToLower().Contains(term)
                    )));
        }

        var totalCount = await baseQuery.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<OrderDto>([], page, pageSize, 0);
        }

        var orders = await baseQuery
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(o => o.Customer)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .Include(o => o.OrderBundlePromotions)
                .ThenInclude(obp => obp.Promotion)
            .ToListAsync(cancellationToken);

        var allParentProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var allAddOnProductIds = orders
            .SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
            .SelectMany(oi => oi.InverseParentOrderItem)
            .Select(child => child.ProductId)
            .Distinct()
            .ToList();

        var overridePrices = new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();
        if (allAddOnProductIds.Count > 0)
        {
            overridePrices = await db.ProductAddOnPriceOverrides
                .Where(o => allParentProductIds.Contains(o.ProductId) && allAddOnProductIds.Contains(o.AddOnId) && o.IsActive)
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
        }

        var items = orders.Select(o =>
        {
            var orderItems = o.OrderItems
                .Where(oi => oi.ParentOrderItemId == null)
                .OrderBy(oi => oi.SortOrder)
                .ThenBy(oi => oi.Id)
                .Select(oi =>
                {
                    var addOns = oi.InverseParentOrderItem
                        .OrderBy(child => child.SortOrder)
                        .ThenBy(child => child.Id)
                        .Select(child =>
                        {
                            var childEffectivePrice = child.Price
                                ?? (overridePrices.TryGetValue((oi.ProductId, child.ProductId), out var op) ? op : child.Product.Price);

                            return new OrderItemDto(
                                child.Id,
                                child.ProductId,
                                child.Product.Name,
                                child.Quantity,
                                childEffectivePrice,
                                [],
                                child.SpecialInstructions,
                                child.BundlePromotionId);
                        })
                        .ToList();

                    return new OrderItemDto(
                        oi.Id,
                        oi.ProductId,
                        oi.Product.Name,
                        oi.Quantity,
                        oi.Price ?? oi.Product.Price,
                        addOns,
                        oi.SpecialInstructions,
                        oi.BundlePromotionId);
                })
                .ToList();

            var bundlePromotions = o.OrderBundlePromotions
                .Select(obp => new OrderBundlePromotionDto(
                    obp.PromotionId,
                    obp.Promotion.Name,
                    obp.Quantity,
                    obp.UnitPrice))
                .ToList();

            var totalAmount = OrderMetrics.ComputeOrderTotal(o, overridePrices);

            return new OrderDto(
                o.Id,
                o.OrderNumber,
                o.CreatedAt,
                o.CreatedBy,
                o.UpdatedAt,
                o.UpdatedBy,
                orderItems,
                o.CustomerId,
                (OrderStatusEnum)o.StatusId,
                o.PaymentMethodId.HasValue ? (PaymentMethodEnum)o.PaymentMethodId.Value : null,
                o.AmountReceived,
                o.ChangeAmount,
                o.Tips,
                o.SpecialInstructions,
                o.Note,
                totalAmount,
                o.Customer == null ? null : $"{o.Customer.FirstName} {o.Customer.LastName}".Trim(),
                bundlePromotions);
        }).ToList();

        return new PagedResultDto<OrderDto>(items, page, pageSize, totalCount);
    }
}
