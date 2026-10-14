using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

public sealed record GetProductSalesReportQuery : IRequest<List<ProductSalesReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public int? CategoryId { get; init; }
    public int? SubCategoryId { get; init; }
    public bool? SplitAddOns { get; init; }
    /// <summary>Only orders that came from this source: the shop itself or a customer ordering link. Null means all.</summary>
    public OrderSourceEnum? Source { get; init; }
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
    private const string AddOnCategoryName = "Add-ons";

    public async Task<List<ProductSalesReportRowDto>> Handle(GetProductSalesReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;
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
                    && (oi.Order.StatusId == OrderStatuses.Completed || oi.Order.StatusId == OrderStatuses.Refunded)
                    && (source == null || oi.Order.Source == source));

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

        var overridePrices = await AddOnPriceLookup.ForParentItemsAsync(db, parentItems, cancellationToken);

        var splitAddOns = request.SplitAddOns == true;
        var lines = new List<SalesLine>();

        foreach (var parent in parentItems)
        {
            var addOns = parent.InverseParentOrderItem.Where(child => child.BundlePromotionId == null).ToList();
            var parentAddOns = splitAddOns ? [] : addOns;
            var total = OrderMetrics.ComputeParentItemTotal(parent, parentAddOns, overridePrices);
            var gross = total + OrderMetrics.ComputeParentItemDiscount(parent);
            lines.Add(SalesLine.From(
                parent.ProductId,
                parent.Product.Name,
                parent.Product.Category.Name,
                parent.Product.SubCategory?.Name,
                parent.Quantity,
                gross,
                gross - total,
                total,
                parent.Order.StatusId));

            if (!splitAddOns)
            {
                continue;
            }

            foreach (var addOn in addOns)
            {
                var addOnTotal = OrderMetrics.ComputeAddOnTotal(parent, addOn, overridePrices);
                lines.Add(SalesLine.From(
                    addOn.ProductId,
                    addOn.Product.Name,
                    AddOnCategoryName,
                    null,
                    addOn.Quantity * parent.Quantity,
                    addOnTotal,
                    0m,
                    addOnTotal,
                    parent.Order.StatusId));
            }
        }

        if (includePromotions)
        {
            var bundleQuery = db.OrderBundlePromotions
                .AsNoTracking()
                .Include(obp => obp.Order)
                .Include(obp => obp.Promotion)
                .Where(obp =>
                    obp.Order.CreatedAt >= fromUtc
                    && obp.Order.CreatedAt < toExclusiveUtc
                    && (obp.Order.StatusId == OrderStatuses.Completed || obp.Order.StatusId == OrderStatuses.Refunded)
                    && (source == null || obp.Order.Source == source)
                    && (obp.Promotion.TypeId == FixedBundlePromotionTypeId
                        || obp.Promotion.TypeId == MixMatchPromotionTypeId));

            if (promotionTypeFilter.HasValue)
            {
                bundleQuery = bundleQuery.Where(obp => obp.Promotion.TypeId == promotionTypeFilter.Value);
            }

            var bundles = await bundleQuery.ToListAsync(cancellationToken);
            lines.AddRange(bundles.Select(bundle =>
            {
                var bundleTotal = bundle.UnitPrice * bundle.Quantity;
                return SalesLine.From(
                    bundle.PromotionId,
                    bundle.Promotion.Name,
                    BundleCategoryName,
                    GetPromotionSubCategoryLabel(bundle.Promotion.TypeId),
                    bundle.Quantity,
                    bundleTotal,
                    0m,
                    bundleTotal,
                    bundle.Order.StatusId);
            }));
        }

        var grouped = lines
            .GroupBy(line => (line.ProductId, line.Name, line.CategoryName, line.SubCategoryName))
            .Select(g => (
                g.Key.ProductId,
                g.Key.Name,
                g.Key.CategoryName,
                g.Key.SubCategoryName,
                Quantity: g.Sum(l => l.Quantity),
                Gross: g.Sum(l => l.Gross),
                Discount: g.Sum(l => l.Discount),
                Refunded: g.Sum(l => l.Refunded),
                Net: g.Sum(l => l.Net)))
            .OrderByDescending(r => r.Net)
            .ToList();

        var totalRevenue = grouped.Sum(row => row.Net);

        return grouped
            .Select(row => new ProductSalesReportRowDto(
                row.ProductId,
                row.Name,
                row.CategoryName,
                row.SubCategoryName,
                row.Quantity,
                row.Net,
                SalesRules.PercentOfTotal(row.Net, totalRevenue),
                row.CategoryName == AddOnCategoryName,
                row.Gross,
                row.Discount,
                row.Refunded))
            .ToList();
    }

    private sealed record SalesLine(
        Guid ProductId,
        string Name,
        string CategoryName,
        string? SubCategoryName,
        int Quantity,
        decimal Gross,
        decimal Discount,
        decimal Refunded,
        decimal Net)
    {
        // A refunded order counts as gross and discount but not as quantity sold or net; its value shows under Refunded.
        public static SalesLine From(
            Guid productId,
            string name,
            string categoryName,
            string? subCategoryName,
            int quantity,
            decimal gross,
            decimal discount,
            decimal total,
            int statusId) =>
            statusId == OrderStatuses.Refunded
                ? new SalesLine(productId, name, categoryName, subCategoryName, 0, gross, discount, total, 0m)
                : new SalesLine(productId, name, categoryName, subCategoryName, quantity, gross, discount, 0m, total);
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
