using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
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

public sealed class GetProductSalesReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductSalesReportQuery, List<ProductSalesReportRowDto>>
{
    private const int PromotionsCategoryFilterId = -1;
    private const int PromotionTypeFixedSubCategoryFilterId = -101;
    private const int PromotionTypeMixMatchSubCategoryFilterId = -102;
    private const int FixedBundlePromotionTypeId = 1;
    private const int MixMatchPromotionTypeId = 2;
    private const string BundleCategoryName = "Promotions";

    public async Task<List<ProductSalesReportRowDto>> Handle(GetProductSalesReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);
        var promotionTypeFilter = ResolvePromotionTypeFilter(request.SubCategoryId);
        var productSubCategoryFilter = ResolveProductSubCategoryFilter(request.SubCategoryId);

        var includeProducts =
            (!request.CategoryId.HasValue || request.CategoryId.Value != PromotionsCategoryFilterId)
            && !promotionTypeFilter.HasValue;
        var includePromotions =
            (!request.CategoryId.HasValue || request.CategoryId.Value == PromotionsCategoryFilterId)
            && !productSubCategoryFilter.HasValue;

        var parentItems = new List<OrderItem>();
        if (includeProducts)
        {
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
                    && oi.BundlePromotionId == null
                    && oi.Order.CreatedAt >= fromUtc
                    && oi.Order.CreatedAt < toExclusiveUtc
                    && oi.Order.StatusId == (int)OrderStatusEnum.Completed);

            if (request.CategoryId.HasValue && request.CategoryId.Value != PromotionsCategoryFilterId)
            {
                query = query.Where(oi => oi.Product.CategoryId == request.CategoryId.Value);
            }

            if (productSubCategoryFilter.HasValue)
            {
                query = query.Where(oi => oi.Product.SubCategoryId == productSubCategoryFilter.Value);
            }

            parentItems = await query.ToListAsync(cancellationToken);
        }

        var overridePrices = await BuildAddOnOverridePriceLookup(parentItems, cancellationToken);

        var productRows = parentItems
            .Select(parentItem => new
            {
                ParentItem = parentItem,
                Revenue = OrderMetrics.ComputeParentItemTotal(
                    parentItem,
                    parentItem.InverseParentOrderItem.Where(child => child.BundlePromotionId == null),
                    overridePrices)
            })
            .GroupBy(oi => new
            {
                oi.ParentItem.ProductId,
                oi.ParentItem.Product.Name,
                CategoryName = oi.ParentItem.Product.Category.Name,
                SubCategoryName = oi.ParentItem.Product.SubCategory != null ? oi.ParentItem.Product.SubCategory.Name : null
            })
            .Select(g => new
            {
                g.Key.ProductId,
                ProductName = g.Key.Name,
                g.Key.CategoryName,
                g.Key.SubCategoryName,
                QuantitySold = g.Sum(oi => oi.ParentItem.Quantity),
                Revenue = g.Sum(oi => oi.Revenue)
            })
            .ToList();

        var bundleRows = new List<(Guid ProductId, string ProductName, string CategoryName, string? SubCategoryName, int QuantitySold, decimal Revenue)>();
        if (includePromotions)
        {
            var bundleQuery = db.OrderBundlePromotions
                .AsNoTracking()
                .Include(obp => obp.Order)
                .Include(obp => obp.Promotion)
                .Where(obp =>
                    obp.Order.CreatedAt >= fromUtc
                    && obp.Order.CreatedAt < toExclusiveUtc
                    && obp.Order.StatusId == (int)OrderStatusEnum.Completed
                    && (obp.Promotion.TypeId == FixedBundlePromotionTypeId
                        || obp.Promotion.TypeId == MixMatchPromotionTypeId));

            if (promotionTypeFilter.HasValue)
            {
                bundleQuery = bundleQuery.Where(obp => obp.Promotion.TypeId == promotionTypeFilter.Value);
            }

            var groupedBundleRows = await bundleQuery
                .GroupBy(obp => new { obp.PromotionId, obp.Promotion.Name, obp.Promotion.TypeId })
                .Select(g => new
                {
                    ProductId = g.Key.PromotionId,
                    ProductName = g.Key.Name,
                    PromotionTypeId = g.Key.TypeId,
                    QuantitySold = g.Sum(x => x.Quantity),
                    Revenue = g.Sum(x => x.UnitPrice * x.Quantity)
                })
                .ToListAsync(cancellationToken);

            bundleRows = groupedBundleRows
                .Select(x => (
                    x.ProductId,
                    x.ProductName,
                    BundleCategoryName,
                    (string?)GetPromotionSubCategoryLabel(x.PromotionTypeId),
                    x.QuantitySold,
                    x.Revenue))
                .ToList();
        }

        var grouped = productRows
            .Select(row => (
                row.ProductId,
                row.ProductName,
                row.CategoryName,
                row.SubCategoryName,
                row.QuantitySold,
                row.Revenue))
            .Concat(bundleRows)
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

    private async Task<Dictionary<(Guid ProductId, Guid AddOnId), decimal>> BuildAddOnOverridePriceLookup(
        IReadOnlyCollection<OrderItem> parentItems,
        CancellationToken cancellationToken)
    {
        var parentProductIds = parentItems
            .Select(oi => oi.ProductId)
            .Distinct()
            .ToList();

        var addOnProductIds = parentItems
            .SelectMany(oi => oi.InverseParentOrderItem)
            .Select(child => child.ProductId)
            .Distinct()
            .ToList();

        if (addOnProductIds.Count == 0)
        {
            return [];
        }

        return await db.ProductAddOnPriceOverrides
            .Where(o => parentProductIds.Contains(o.ProductId)
                && addOnProductIds.Contains(o.AddOnId)
                && o.IsActive)
            .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);
    }

    private static int? ResolvePromotionTypeFilter(int? subCategoryId)
    {
        if (!subCategoryId.HasValue)
        {
            return null;
        }

        return subCategoryId.Value switch
        {
            PromotionTypeFixedSubCategoryFilterId => FixedBundlePromotionTypeId,
            PromotionTypeMixMatchSubCategoryFilterId => MixMatchPromotionTypeId,
            _ => null
        };
    }

    private static int? ResolveProductSubCategoryFilter(int? subCategoryId)
    {
        if (!subCategoryId.HasValue)
        {
            return null;
        }

        if (subCategoryId.Value is PromotionTypeFixedSubCategoryFilterId or PromotionTypeMixMatchSubCategoryFilterId)
        {
            return null;
        }

        return subCategoryId.Value;
    }

    private static string GetPromotionSubCategoryLabel(int promotionTypeId)
    {
        return promotionTypeId switch
        {
            FixedBundlePromotionTypeId => "Fixed Bundle",
            MixMatchPromotionTypeId => "Mix & Match",
            _ => "Promotion"
        };
    }
}
