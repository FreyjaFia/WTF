using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record GetStockCoverageQuery : IRequest<StockCoverageDto>;

public class GetStockCoverageHandler(WTFDbContext db) : IRequestHandler<GetStockCoverageQuery, StockCoverageDto>
{
    private static readonly int[] RequiredTypeIds = [(int)AddOnTypeEnum.Size, (int)AddOnTypeEnum.Flavor];

    public async Task<StockCoverageDto> Handle(GetStockCoverageQuery request, CancellationToken cancellationToken)
    {
        var products = await db.Products
            .AsNoTracking()
            .Where(p => p.IsActive && !p.IsAddOn)
            .Select(p => new { p.Id, p.Name, p.Code })
            .ToListAsync(cancellationToken);

        var linkedProductIds = (await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.IsActive && link.Item.IsActive)
            .Select(link => link.ProductId)
            .Distinct()
            .ToListAsync(cancellationToken)).ToHashSet();

        var addOnRows = await db.ProductAddOns
            .AsNoTracking()
            .Where(pa => pa.IsActive && pa.AddOn.IsActive && pa.AddOnTypeId != null && RequiredTypeIds.Contains(pa.AddOnTypeId.Value))
            .Select(pa => new { pa.ProductId, pa.AddOnId, AddOnName = pa.AddOn.Name, TypeId = pa.AddOnTypeId!.Value })
            .ToListAsync(cancellationToken);
        var addOnsByProduct = addOnRows.ToLookup(row => row.ProductId);

        var results = products
            .Select(product =>
            {
                var groups = addOnsByProduct[product.Id]
                    .GroupBy(row => row.TypeId)
                    .OrderBy(group => group.Key)
                    .Select(group => new CoverageGroup(
                        ((AddOnTypeEnum)group.Key).ToString(),
                        group.OrderBy(row => row.AddOnName)
                            .Select(row => new CoverageOption(row.AddOnName, linkedProductIds.Contains(row.AddOnId)))
                            .ToList()))
                    .ToList();

                var result = StockCoverageRules.Evaluate(linkedProductIds.Contains(product.Id), groups);
                return new { product, result };
            })
            .ToList();

        return new StockCoverageDto(
            results.Count(r => r.result.Coverage == StockCoverage.Covered),
            results.Count(r => r.result.Coverage == StockCoverage.Partial),
            results.Count(r => r.result.Coverage == StockCoverage.Missing),
            results
                .OrderByDescending(r => r.result.Coverage)
                .ThenBy(r => r.product.Name)
                .Select(r => new ProductCoverageDto(
                    r.product.Id,
                    r.product.Name,
                    r.product.Code,
                    r.result.Coverage.ToString(),
                    r.result.MissingOptions.ToList()))
                .ToList());
    }
}
