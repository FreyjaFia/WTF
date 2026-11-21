using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

internal static class ProductBranchPricesLoader
{
    public static async Task<ProductBranchPricesDto?> LoadAsync(WTFDbContext db, Guid productId, CancellationToken cancellationToken)
    {
        var product = await db.Products.AsNoTracking()
            .Where(p => p.Id == productId)
            .Select(p => new { p.Id, p.Name, p.Price })
            .FirstOrDefaultAsync(cancellationToken);
        if (product is null)
        {
            return null;
        }

        var branches = await BranchRules.AllOfShop(db).AsNoTracking()
            .Where(b => b.IsActive)
            .OrderByDescending(b => b.IsMain)
            .ThenBy(b => b.Name)
            .Select(b => new { b.Id, b.Name, b.Code, b.IsMain })
            .ToListAsync(cancellationToken);
        var prices = await db.ProductBranchPrices.IgnoreQueryFilters([WTFDbContext.BranchFilterName]).AsNoTracking()
            .Where(p => p.ProductId == product.Id)
            .ToDictionaryAsync(p => p.BranchId, p => p.Price, cancellationToken);

        var rows = branches
            .Select(b =>
            {
                decimal? own = prices.TryGetValue(b.Id, out var price) ? price : null;
                return new ProductBranchPriceRowDto(b.Id, b.Name, b.Code, b.IsMain, own, own ?? product.Price);
            })
            .ToList();

        return new ProductBranchPricesDto(product.Id, product.Name, product.Price, rows);
    }
}
