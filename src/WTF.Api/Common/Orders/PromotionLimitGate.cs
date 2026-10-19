namespace WTF.Api.Common.Orders;

// One order at a time reads the uses a limited promotion has left and saves its own. Without it two registers that
// complete an order at the same moment both see "1 use left" and both take it. The gate is per process; the API runs
// as one instance. Code that already holds it (the offline sync, the batch, the customer submit) tells the order
// handler so it does not wait for itself.
internal static class PromotionLimitGate
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task<IDisposable> EnterAsync(CancellationToken cancellationToken)
    {
        await Gate.WaitAsync(cancellationToken);
        return new Lease();
    }

    // Releasing twice is safe, so a handler can let go right after it commits and still dispose at the end.
    private sealed class Lease : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                Gate.Release();
            }
        }
    }
}
