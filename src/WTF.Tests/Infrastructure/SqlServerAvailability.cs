using Microsoft.Data.SqlClient;

namespace WTF.Tests.Infrastructure;

/// <summary>
/// Finds the SQL Server the database tests run against and says whether it can be reached.
///
/// The server comes from the WTF_TEST_SQL environment variable (a connection string WITHOUT a database,
/// e.g. "Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=true"). CI sets it to a SQL Server
/// container. When it is not set, LocalDB is used, which is installed with Visual Studio and SQL Server Express.
/// </summary>
internal static class SqlServerAvailability
{
    public const string EnvironmentVariable = "WTF_TEST_SQL";

    private const string LocalDb =
        @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=15";

    private static readonly Lazy<(bool Available, string Reason)> Probe = new(CheckServer);

    /// <summary>Connection string of the server (no database selected).</summary>
    public static string ServerConnectionString { get; } =
        Environment.GetEnvironmentVariable(EnvironmentVariable) is { Length: > 0 } configured ? configured : LocalDb;

    public static bool IsAvailable => Probe.Value.Available;

    /// <summary>Shown as the skip reason when no server can be reached.</summary>
    public static string SkipReason =>
        $"No SQL Server is reachable ({Probe.Value.Reason}). Set {EnvironmentVariable} to a connection string, or install LocalDB.";

    private static (bool, string) CheckServer()
    {
        // A server named in WTF_TEST_SQL (the CI container) can still be starting when the tests begin, so wait
        // for it (up to about 2 minutes). LocalDB starts on demand, so one attempt is enough there.
        var attempts = Environment.GetEnvironmentVariable(EnvironmentVariable) is { Length: > 0 } ? 24 : 1;
        var reason = "not tried";

        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                using var connection = new SqlConnection(ServerConnectionString);
                connection.Open();
                return (true, "ok");
            }
            catch (Exception ex)
            {
                reason = ex.GetType().Name + ": " + ex.Message.Split('\n')[0].Trim();
                if (attempt < attempts)
                {
                    Thread.Sleep(TimeSpan.FromSeconds(5));
                }
            }
        }

        return (false, reason);
    }
}

/// <summary>A [Fact] that is skipped (with a clear message) when no SQL Server can be reached.</summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class SqlFactAttribute : FactAttribute
{
    public SqlFactAttribute()
    {
        if (!SqlServerAvailability.IsAvailable)
        {
            Skip = SqlServerAvailability.SkipReason;
        }
    }
}

/// <summary>A [Theory] that is skipped (with a clear message) when no SQL Server can be reached.</summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class SqlTheoryAttribute : TheoryAttribute
{
    public SqlTheoryAttribute()
    {
        if (!SqlServerAvailability.IsAvailable)
        {
            Skip = SqlServerAvailability.SkipReason;
        }
    }
}
