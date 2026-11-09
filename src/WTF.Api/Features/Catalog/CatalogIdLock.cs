using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using WTF.Domain.Data;

namespace WTF.Api.Features.Catalog;

internal static class CatalogIdLock
{
    public const string Resource = "wtf-tenant-catalog-copy";

    // Catalog ids are picked after the highest id in use, so saves (and new shops copying the template) take turns
    // until the transaction ends.
    public static async Task<IDbContextTransaction?> AcquireAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational())
        {
            return null;
        }

        var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        await db.Database.ExecuteSqlRawAsync(
            $"DECLARE @result int; EXEC @result = sp_getapplock @Resource = N'{Resource}', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 60000; IF @result < 0 THROW 50000, N'Could not reserve a catalog id.', 1;",
            cancellationToken);

        return transaction;
    }
}
