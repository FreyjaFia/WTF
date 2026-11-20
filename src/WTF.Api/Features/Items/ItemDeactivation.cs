using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

internal static class ItemDeactivation
{
    private const int NamesShown = 5;

    public static async Task EnsureNoActiveProductLinksAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        var products = await db.ProductItemLinks
            .AsNoTracking()
            .Where(link => link.ItemId == itemId && link.IsActive && link.Product.IsActive)
            .Select(link => link.Product.Name)
            .Distinct()
            .OrderBy(name => name)
            .ToListAsync(cancellationToken);

        if (products.Count == 0)
        {
            return;
        }

        var shown = string.Join(", ", products.Take(NamesShown));
        var more = products.Count > NamesShown ? $" and {products.Count - NamesShown} more" : string.Empty;
        throw new InvalidOperationException(
            $"This item is still used by {products.Count} product(s): {shown}{more}. Unlink them first, or the sales of those products would stop taking this item.");
    }

    // A deleted item is out of the alerts for good: forget its alert level so a restore while still low alerts again.
    public static async Task ForgetAlertStateAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        var rows = db.ItemBranchStocks
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(s => s.ItemId == itemId && s.LastAlertStatus != 0);

        if (db.Database.IsRelational())
        {
            await rows.ExecuteUpdateAsync(setters => setters.SetProperty(s => s.LastAlertStatus, (byte)0), cancellationToken);
            return;
        }

        foreach (var row in await rows.ToListAsync(cancellationToken))
        {
            row.LastAlertStatus = 0;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
