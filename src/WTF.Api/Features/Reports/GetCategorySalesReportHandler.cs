using MediatR;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;

namespace WTF.Api.Features.Reports;

public sealed record GetCategorySalesReportQuery : IRequest<List<CategorySalesReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetCategorySalesReportHandler(ISender sender) : IRequestHandler<GetCategorySalesReportQuery, List<CategorySalesReportRowDto>>
{
    public async Task<List<CategorySalesReportRowDto>> Handle(GetCategorySalesReportQuery request, CancellationToken cancellationToken)
    {
        var products = await sender.Send(
            new GetProductSalesReportQuery
            {
                FromDate = request.FromDate,
                ToDate = request.ToDate,
                Source = request.Source
            },
            cancellationToken);

        var totalRevenue = products.Sum(p => p.Revenue);

        return products
            .GroupBy(p => p.CategoryName)
            .Select(g => new CategorySalesReportRowDto(
                g.Key,
                g.Sum(p => p.QuantitySold),
                g.Sum(p => p.GrossSales),
                g.Sum(p => p.Discounts),
                g.Sum(p => p.RefundedAmount),
                g.Sum(p => p.Revenue),
                SalesRules.PercentOfTotal(g.Sum(p => p.Revenue), totalRevenue)))
            .OrderByDescending(r => r.Revenue)
            .ToList();
    }
}
