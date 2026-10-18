using WTF.Api.Common.Orders;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Common;

public class ReportQueryLimitsTests
{
    private static async Task<string> SeedStatusesAsync(int count)
    {
        var name = TestDb.NewName();
        await TestDb.SaveAsync(name, Enumerable.Range(1, count).Select(i => (object)new Status { Id = i, Name = "S" + i }).ToArray());
        return name;
    }

    [Fact]
    public async Task ToReportListAsync_AtTheLimit_ReturnsEveryRow()
    {
        var name = await SeedStatusesAsync(5);
        await using var db = TestDb.Create(name);

        var rows = await db.Statuses.ToReportListAsync(CancellationToken.None, maxRows: 5);

        rows.Count.ShouldBe(5);
    }

    [Fact]
    public async Task ToReportListAsync_OverTheLimit_ThrowsAClearMessage()
    {
        var name = await SeedStatusesAsync(6);
        await using var db = TestDb.Create(name);

        var error = await Should.ThrowAsync<InvalidOperationException>(
            () => db.Statuses.ToReportListAsync(CancellationToken.None, maxRows: 5));

        error.Message.ShouldContain("more than 5 rows");
        error.Message.ShouldContain("Narrow the date range");
    }
}
