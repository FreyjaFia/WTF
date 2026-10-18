using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record GetPublicOrdersQuery(string Token, int Page = 1, int PageSize = 20)
    : IRequest<PagedResultDto<PublicOrderDto>?>;

public record GetPublicOrderQuery(string Token, Guid OrderId) : IRequest<PublicOrderDto?>;

/// <summary>
/// My orders. A customer sees the orders they placed through any of their links (so a regenerated link keeps the
/// history), never POS orders and never another customer's orders.
/// </summary>
public class GetPublicOrdersHandler(WTFDbContext db, IHttpContextAccessor? httpContextAccessor = null)
    : IRequestHandler<GetPublicOrdersQuery, PagedResultDto<PublicOrderDto>?>,
      IRequestHandler<GetPublicOrderQuery, PublicOrderDto?>
{
    private const int MaxPageSize = 50;

    public async Task<PagedResultDto<PublicOrderDto>?> Handle(
        GetPublicOrdersQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        if (access == null)
        {
            return null;
        }

        var page = request.Page <= 0 ? 1 : request.Page;
        var pageSize = request.PageSize <= 0 ? 20 : Math.Min(request.PageSize, MaxPageSize);

        var query = OwnOrders(access.Customer.Id);
        var total = await query.CountAsync(cancellationToken);

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .ThenByDescending(o => o.OrderNumber)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(o => o.OrderItems).ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return new PagedResultDto<PublicOrderDto>(
            await PublicOrderMapping.ToDtosAsync(db, orders, httpContextAccessor, cancellationToken), page, pageSize, total);
    }

    public async Task<PublicOrderDto?> Handle(GetPublicOrderQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        if (access == null)
        {
            return null;
        }

        var order = await OwnOrders(access.Customer.Id)
            .Where(o => o.Id == request.OrderId)
            .Include(o => o.OrderItems).ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .AsSplitQuery()
            .FirstOrDefaultAsync(cancellationToken);

        if (order == null)
        {
            return null;
        }

        return (await PublicOrderMapping.ToDtosAsync(db, [order], httpContextAccessor, cancellationToken))[0];
    }

    private IQueryable<WTF.Domain.Entities.Order> OwnOrders(Guid customerId) =>
        db.Orders.Where(o => o.CustomerId == customerId && o.Source == (byte)OrderSourceEnum.CustomerLink);
}
