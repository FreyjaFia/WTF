using System.Collections.Concurrent;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Orders;

// One order at a time reads the uses a limited promotion has left and saves its own. Without it two registers that
// complete an order at the same moment both see "1 use left" and both take it. There is one gate per tenant, so a busy
// shop never makes another wait, and promotions never cross tenants. The gate is per process; the API runs as one
// instance. Code that already holds it (the offline sync, the batch, the customer submit) tells the order handler so
// it does not wait for itself.
internal static class PromotionLimitGate
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> Gates = new();

    public static Task<IDisposable> EnterAsync(CancellationToken cancellationToken) =>
        EnterAsync(null, cancellationToken);

    public static async Task<IDisposable> EnterAsync(Guid? tenantId, CancellationToken cancellationToken)
    {
        var key = tenantId is { } id && id != Guid.Empty ? id : TenantDefaults.DefaultTenantId;
        var gate = Gates.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        return new Lease(gate);
    }

    // Releasing twice is safe, so a handler can let go right after it commits and still dispose at the end.
    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                gate.Release();
            }
        }
    }
}
