using WTF.Api.Features.Audit;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Audit;

public class GetSchemaScriptHistoryHandlerTests
{
    private readonly string _db = TestDb.NewName();

    [Fact]
    public async Task Handle_NoScripts_ReturnsEmptyList()
    {
        (await new GetSchemaScriptHistoryHandler(TestDb.Create(_db))
            .Handle(new GetSchemaScriptHistoryQuery(), CancellationToken.None)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_Scripts_ReturnedNewestAppliedFirstTiesByHigherId()
    {
        var t = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await using (var db = TestDb.Create(_db))
        {
            db.SchemaScriptHistories.AddRange(
                new SchemaScriptHistory { Id = 1, ScriptName = "001_init.sql", AppliedAt = t },
                new SchemaScriptHistory { Id = 2, ScriptName = "002_items.sql", AppliedAt = t.AddDays(1) },
                new SchemaScriptHistory { Id = 3, ScriptName = "003_same_time.sql", AppliedAt = t.AddDays(1) });
            await db.SaveChangesAsync();
        }

        var r = await new GetSchemaScriptHistoryHandler(TestDb.Create(_db))
            .Handle(new GetSchemaScriptHistoryQuery(), CancellationToken.None);

        r.Select(s => s.ScriptName).ShouldBe(["003_same_time.sql", "002_items.sql", "001_init.sql"]);
        r[0].AppliedAt.ShouldBe(t.AddDays(1));
    }
}
