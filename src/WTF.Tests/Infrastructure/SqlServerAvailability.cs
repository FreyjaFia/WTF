using Microsoft.Data.SqlClient;

namespace WTF.Tests.Infrastructure;

// Finds the SQL Server the database tests run against and says whether it can be reached.
//
// The server comes from the WTF_TEST_SQL environment variable (a connection string WITHOUT a database,
// e.g. "Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=true"). CI sets it to a SQL Server
// container. When it is not set, LocalDB is used, which is installed with Visual Studio and SQL Server Express.
internal static class SqlServerAvailability
{
    public const string EnvironmentVariable = "WTF_TEST_SQL";

    private const string LocalDb =
        @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=15";

    private static readonly Lazy<(bool Available, string Reason)> Probe = new(CheckServer);

    public static string ServerConnectionString { get; } =
        Environment.GetEnvironmentVariable(EnvironmentVariable) is { Length: > 0 } configured ? configured : LocalDb;

    public static bool IsAvailable => Probe.Value.Available;

    // On CI a missing server must fail the run: a skipped database test looks the same as a passing one.
    public static bool ShouldSkip => !IsAvailable && !RequiredByCi;

    private static bool RequiredByCi =>
        Environment.GetEnvironmentVariable("CI") is { Length: > 0 } ci && !ci.Equals("false", StringComparison.OrdinalIgnoreCase);

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

[AttributeUsage(AttributeTargets.Method)]
internal sealed class SqlFactAttribute : FactAttribute
{
    public SqlFactAttribute()
    {
        if (SqlServerAvailability.ShouldSkip)
        {
            Skip = SqlServerAvailability.SkipReason;
        }
    }
}

[AttributeUsage(AttributeTargets.Method)]
internal sealed class SqlTheoryAttribute : TheoryAttribute
{
    public SqlTheoryAttribute()
    {
        if (SqlServerAvailability.ShouldSkip)
        {
            Skip = SqlServerAvailability.SkipReason;
        }
    }
}
