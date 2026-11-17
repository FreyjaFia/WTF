using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Kitchen;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public sealed record GetPagedOrdersQuery(
    OrderStatusEnum Status = OrderStatusEnum.All,
    Guid? CustomerId = null,
    bool ExcludeFinalized = false,
    string? SearchTerm = null,
    int Page = 1,
    int PageSize = 20,
    OrderSourceEnum? Source = null,
    int[]? Statuses = null,
    DateTimeOffset? From = null,
    DateTimeOffset? To = null,
    string? SortBy = null,
    string? SortDirection = null,
    string? Kitchen = null,
    Guid? BranchId = null) : IRequest<PagedResultDto<OrderDto>>;

public sealed class GetPagedOrdersHandler(WTFDbContext db, ITenantFeatures tenantFeatures, IHttpContextAccessor? httpContextAccessor = null)
    : IRequestHandler<GetPagedOrdersQuery, PagedResultDto<OrderDto>>
{
    private const int DefaultPageSize = 20;

    public async Task<PagedResultDto<OrderDto>> Handle(GetPagedOrdersQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, DefaultPageSize);

        var baseQuery = db.Orders.AsQueryable();

        if (request.CustomerId.HasValue)
        {
            baseQuery = baseQuery.Where(o => o.CustomerId == request.CustomerId.Value);
        }

        if (request.BranchId.HasValue)
        {
            baseQuery = baseQuery.Where(o => o.BranchId == request.BranchId.Value);
        }

        if (request.Source.HasValue)
        {
            var source = (byte)request.Source.Value;
            baseQuery = baseQuery.Where(o => o.Source == source);
        }

        if (request.From.HasValue)
        {
            var from = request.From.Value.UtcDateTime;
            baseQuery = baseQuery.Where(o => o.CreatedAt >= from);
        }

        if (request.To.HasValue)
        {
            var to = request.To.Value.UtcDateTime;
            baseQuery = baseQuery.Where(o => o.CreatedAt <= to);
        }

        // "open" is still with the kitchen (New, Preparing or Ready), "served" was handed over, "none" is not tracked by it.
        baseQuery = request.Kitchen?.Trim().ToLowerInvariant() switch
        {
            "open" => baseQuery.Where(o => o.KitchenStatus != null && o.KitchenStatus < (byte)KitchenState.Served),
            "served" => baseQuery.Where(o => o.KitchenStatus == (byte)KitchenState.Served),
            "none" => baseQuery.Where(o => o.KitchenStatus == null),
            _ => baseQuery
        };

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var term = request.SearchTerm.Trim().ToLower();
            baseQuery = baseQuery.Where(o =>
                o.OrderNumber.ToString().Contains(term) ||
                (o.CustomerAddress != null && o.CustomerAddress.ToLower().Contains(term)) ||
                (o.Customer != null &&
                    (
                        (o.Customer.FirstName + " " + (o.Customer.LastName ?? "")).ToLower().Contains(term) ||
                        ((o.Customer.LastName ?? "") + " " + o.Customer.FirstName).ToLower().Contains(term)
                    )));
        }

        // Counts for the status chips follow every other filter but not the status itself.
        var facets = await BuildFacetsAsync(baseQuery, cancellationToken);

        var query = ApplyStatus(baseQuery, request);
        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<OrderDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var orders = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(o => o.Customer)
            .Include(o => o.Branch)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.InverseParentOrderItem)
                    .ThenInclude(child => child.Product)
            .Include(o => o.OrderBundlePromotions)
                .ThenInclude(obp => obp.Promotion)
            .Include(o => o.OrderSeniorPwdDiscounts)
            .AsNoTrackingWithIdentityResolution()
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        var overridePrices = await AddOnPriceLookup.ForParentItemsAsync(
            db,
            orders.SelectMany(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null)),
            cancellationToken);
        var previewPrices = await PendingOrderPreview.LoadAsync(db, orders, httpContextAccessor, cancellationToken, tenantFeatures);

        var nowUtc = DateTime.UtcNow;
        var agedAfterDays = await HeldOrderAging.AgedAfterDaysAsync(db, cancellationToken);

        var items = orders.Select(o =>
        {
            var isHeld = o.StatusId == (int)OrderStatusEnum.PendingReview;
            var dto = OrderMapping.ToDto(
                o,
                OrderMapping.ToItemDtos(o.OrderItems.Where(oi => oi.ParentOrderItemId == null), overridePrices),
                OrderMetrics.ComputeOrderTotal(o, overridePrices, previewPrices),
                OrderMapping.ToBundleDtos(o),
                o.OrderSeniorPwdDiscounts,
                maskIds: true,
                includeCustomerName: true);

            return dto with
            {
                IsAged = isHeld && HeldOrderRules.IsAged(o.CreatedAt, nowUtc, agedAfterDays),
                HeldDays = isHeld ? HeldOrderRules.AgeDays(o.CreatedAt, nowUtc) : null
            };
        }).ToList();

        return new PagedResultDto<OrderDto>(items, paging.Page, paging.PageSize, totalCount, facets);
    }

    private static IQueryable<Order> ApplyStatus(IQueryable<Order> query, GetPagedOrdersQuery request)
    {
        if (request.Status != OrderStatusEnum.All)
        {
            return query.Where(o => o.StatusId == (int)request.Status);
        }

        if (request.Statuses is { Length: > 0 })
        {
            var statuses = request.Statuses;
            return query.Where(o => statuses.Contains(o.StatusId));
        }

        // Orders waiting for staff (approval or review) are not part of the normal list: they only come back when asked for.
        query = query.Where(o => !OrderStatuses.Unconfirmed.Contains(o.StatusId));

        if (request.ExcludeFinalized)
        {
            query = query.Where(o => o.StatusId != (int)OrderStatusEnum.Completed && o.StatusId != (int)OrderStatusEnum.Refunded);
        }

        return query;
    }

    private static IQueryable<Order> ApplySort(IQueryable<Order> query, GetPagedOrdersQuery request)
    {
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);

        if (string.Equals(request.SortBy, "orderNumber", StringComparison.OrdinalIgnoreCase))
        {
            return ascending
                ? query.OrderBy(o => o.OrderNumber).ThenBy(o => o.Id)
                : query.OrderByDescending(o => o.OrderNumber).ThenByDescending(o => o.Id);
        }

        return ascending
            ? query.OrderBy(o => o.CreatedAt).ThenBy(o => o.Id)
            : query.OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id);
    }

    private static async Task<IReadOnlyDictionary<string, int>> BuildFacetsAsync(IQueryable<Order> query, CancellationToken cancellationToken)
    {
        var grouped = await query
            .Where(o => !OrderStatuses.Unconfirmed.Contains(o.StatusId))
            .GroupBy(o => o.StatusId)
            .Select(g => new { StatusId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var facets = grouped.ToDictionary(g => g.StatusId.ToString(), g => g.Count);
        facets["all"] = grouped.Sum(g => g.Count);

        return facets;
    }
}
