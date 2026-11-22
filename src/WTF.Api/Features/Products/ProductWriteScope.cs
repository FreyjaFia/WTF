using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Orders;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

// Who may change which product. A person who works in every branch and holds products.write changes any product. A person
// limited to some branches never gets that shop-wide power: with products.write.branch they may create products sold only at
// their branches and change the ones that are limited to their branches already.
public static class ProductWriteScope
{
    public const string NotYoursMessage = "This product is sold outside your branches, so only the owner can change it.";
    public const string EverywhereMessage = "Only the owner can sell a product at every branch.";

    public static bool IsShopWide(WTFDbContext db, ClaimsPrincipal user) =>
        PermissionChecks.Has(user, "products.write") && !db.IsBranchLimited;

    public static bool HasBranchKey(ClaimsPrincipal user) => PermissionChecks.Has(user, PermissionKeys.ProductsWriteBranch);

    public static async Task<bool> MayChangeAsync(WTFDbContext db, ClaimsPrincipal user, Guid productId, CancellationToken cancellationToken)
    {
        if (IsShopWide(db, user))
        {
            return true;
        }

        if (!HasBranchKey(user))
        {
            return false;
        }

        var soldAt = await ProductBranchLookup.SoldAtAsync(db, [productId], cancellationToken);
        return ProductAvailability.MayBranchEdit(soldAt.GetValueOrDefault(productId) ?? [], [.. db.AllowedBranchIds]);
    }

    public static async Task EnsureMayChangeAsync(WTFDbContext db, ClaimsPrincipal user, Guid productId, CancellationToken cancellationToken)
    {
        if (!await MayChangeAsync(db, user, productId, cancellationToken))
        {
            throw new ForbiddenActionException(NotYoursMessage);
        }
    }
}

// Put on the product routes that change one product. The product comes from the route; a missing product falls through to its 404.
// A branch-limited person is checked here: products.write alone never reaches a product, only products.write.branch does, and
// only for the products limited to their branches. A person who works in every branch is decided by the route policy.
public sealed class ProductWriteScopeFilter(string routeKey = "id") : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (Guid.TryParse(http.GetRouteValue(routeKey)?.ToString(), out var productId))
        {
            var db = http.RequestServices.GetRequiredService<WTFDbContext>();
            if (ProductWriteScope.IsShopWide(db, http.User) || (!db.IsBranchLimited && !ProductWriteScope.HasBranchKey(http.User)))
            {
                return await next(context);
            }

            if (db.IsBranchLimited && !ProductWriteScope.HasBranchKey(http.User))
            {
                return Results.Json(new { message = ProductWriteScope.NotYoursMessage }, statusCode: StatusCodes.Status403Forbidden);
            }

            var exists = await db.Products.AsNoTracking().AnyAsync(p => p.Id == productId, http.RequestAborted);
            if (exists && !await ProductWriteScope.MayChangeAsync(db, http.User, productId, http.RequestAborted))
            {
                return Results.Json(new { message = ProductWriteScope.NotYoursMessage }, statusCode: StatusCodes.Status403Forbidden);
            }
        }

        return await next(context);
    }
}
