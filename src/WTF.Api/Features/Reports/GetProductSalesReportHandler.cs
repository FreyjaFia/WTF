using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

public sealed record GetProductSalesReportQuery : IRequest<List<ProductSalesReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
    public int? CategoryId { get; init; }
    public int? SubCategoryId { get; init; }
}

public sealed class GetProductSalesReportHandler(WTFDbContext db) : IRequestHandler<GetProductSalesReportQuery, List<ProductSalesReportRowDto>>
{
    public async Task<List<ProductSalesReportRowDto>> Handle(GetProductSalesReportQuery request, CancellationToken cancellationToken)
    {
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate);

        var query = db.OrderItems
            .AsNoTracking()
            .Include(oi => oi.Order)
            .Include(oi => oi.Product)
                .ThenInclude(p => p.Category)
            .Include(oi => oi.Product)
                .ThenInclude(p => p.SubCategory)
            .Include(oi => oi.InverseParentOrderItem)
                .ThenInclude(child => child.Product)
            .Where(oi =>
                oi.ParentOrderItemId == null
                && oi.Order.CreatedAt >= fromUtc
                && oi.Order.CreatedAt < toExclusiveUtc
                && oi.Order.StatusId == (int)OrderStatusEnum.Completed);

        if (request.CategoryId.HasValue)
        {
            query = query.Where(oi => oi.Product.CategoryId == request.CategoryId.Value);
        }

        if (request.SubCategoryId.HasValue)
        {
            query = query.Where(oi => oi.Product.SubCategoryId == request.SubCategoryId.Value);
        }

        var parentItems = await query.ToListAsync(cancellationToken);

        var grouped = parentItems
            .GroupBy(oi => new
            {
                oi.ProductId,
                oi.Product.Name,
                CategoryName = oi.Product.Category.Name,
                SubCategoryName = oi.Product.SubCategory != null ? oi.Product.SubCategory.Name : null
            })
            .Select(g => new
            {
                g.Key.ProductId,
                ProductName = g.Key.Name,
                g.Key.CategoryName,
                g.Key.SubCategoryName,
                QuantitySold = g.Sum(oi => oi.Quantity),
                Revenue = g.Sum(ComputeParentItemRevenue)
            })
            .OrderByDescending(r => r.Revenue)
            .ToList();

        var totalRevenue = grouped.Sum(row => row.Revenue);

        return grouped
            .Select(row => new ProductSalesReportRowDto(
                row.ProductId,
                row.ProductName,
                row.CategoryName,
                row.SubCategoryName,
                row.QuantitySold,
                row.Revenue,
                totalRevenue > 0 ? row.Revenue / totalRevenue * 100 : 0m))
            .ToList();
    }

    private static decimal ComputeParentItemRevenue(OrderItem parentItem)
    {
        var parentUnitPrice = parentItem.Price ?? parentItem.Product.Price;
        var addOnsPerUnit = parentItem.InverseParentOrderItem
            .Sum(child => (child.Price ?? child.Product.Price) * child.Quantity);

        return (parentUnitPrice + addOnsPerUnit) * parentItem.Quantity;
    }
}
