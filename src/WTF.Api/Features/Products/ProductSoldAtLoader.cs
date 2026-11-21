using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

internal static class ProductSoldAtLoader
{
    public static async Task<ProductSoldAtDto?> LoadAsync(WTFDbContext db, ClaimsPrincipal user, Guid productId, CancellationToken cancellationToken)
    {
        var product = await db.Products.AsNoTracking()
            .Where(p => p.Id == productId)
            .Select(p => new { p.Id, p.Name })
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
        var soldAt = (await ProductBranchLookup.SoldAtAsync(db, [product.Id], cancellationToken)).GetValueOrDefault(product.Id) ?? [];
        var isAll = soldAt.Count == 0;

        var rows = branches
            .Select(b => new ProductSoldAtRowDto(b.Id, b.Name, b.Code, b.IsMain, isAll || soldAt.Contains(b.Id)))
            .ToList();

        var canChange = await ProductWriteScope.MayChangeAsync(db, user, product.Id, cancellationToken);
        return new ProductSoldAtDto(product.Id, product.Name, isAll, canChange, ProductWriteScope.IsShopWide(db, user), rows);
    }
}
