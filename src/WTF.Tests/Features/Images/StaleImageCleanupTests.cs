using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Features.Images;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Images;

public class StaleImageCleanupTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IImageStorage _storage = Substitute.For<IImageStorage>();
    private readonly IReportFileStorage _reports = Substitute.For<IReportFileStorage>();
    private byte[]? _savedState;

    public StaleImageCleanupTests()
    {
        _storage.GetKey(Arg.Any<string>()).Returns(ci => ImageKey.From((string)ci[0]));
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<StoredImageInfo>());
        _reports.SaveAsync(Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<string>(), Arg.Any<DateTimeOffset?>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                _savedState = (byte[])ci[1];
                return Task.CompletedTask;
            });
        _reports.ReadAllBytesAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(_savedState));
    }

    private StaleImageCleanupService Service(StaleImageCleanupOptions? options = null) =>
        new(TestDb.Create(_dbName), _storage, _reports, Options.Create(options ?? Live()), NullLogger<StaleImageCleanupService>.Instance);

    private static StaleImageCleanupOptions Live() => new() { Categories = [], DryRun = false, RetentionDays = 30 };

    private static StoredImageInfo File(string key, int ageDays) =>
        new(key, "/" + key, DateTimeOffset.UtcNow.AddDays(-ageDays));

    private Task SeedImageAsync(string url, int ageDays, bool referenced)
    {
        var image = new Image { ImageId = Guid.NewGuid(), ImageUrl = url, UploadedAt = DateTime.UtcNow.AddDays(-ageDays) };
        var entities = new List<object> { image };
        if (referenced)
        {
            entities.Add(new ProductImage { ProductId = Guid.NewGuid(), ImageId = image.ImageId });
        }

        return TestDb.SaveAsync(_dbName, entities.ToArray());
    }

    [Fact]
    public async Task RecentUnreferencedFile_IsKept()
    {
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/new.png", 5)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(0);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    [Fact]
    public async Task OldUnreferencedFile_IsDeleted()
    {
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/old.png", 60)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.OrphanFiles.ShouldBe(1);
        result.Deleted.ShouldBe(1);
        await _storage.Received(1).DeleteAsync("/images/products/old.png", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task FileWithAnImageRow_IsNeverDeleted_AtAnyAge()
    {
        await SeedImageAsync("/images/products/used.png", 400, referenced: true);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/used.png", 400)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(0);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task FileWithDifferentUrlShape_IsStillRecognisedAsUsed()
    {
        // Row saved as a full encoded URL, file listed by plain key: the file name still matches.
        await SeedImageAsync("https://acct.blob.core.windows.net/c/images/products/caf%C3%A9_1.png", 400, referenced: true);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/cafÃ©_1.png", 400)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.OrphanFiles.ShouldBe(0);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    [Fact]
    public async Task NoFileMatchesAnyRow_SkipsFilePass()
    {
        await SeedImageAsync("/somewhere/else/entirely/x.png", 400, referenced: true);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/a.png", 400), File("images/products/b.png", 400)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.OrphanFiles.ShouldBe(0);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    // ---- category scope -------------------------------------------------------------------------

    [Fact]
    public async Task Scope_OnlyListedCategoriesAreTouched()
    {
        await SeedImageAsync("/images/users/used.png", 60, referenced: true);
        await SeedImageAsync("/images/users/gone.png", 60, referenced: false);
        await SeedImageAsync("/images/products/gone.png", 60, referenced: false);
        await SeedLinkedAsync("/images/products/lost.png", 60, out _);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns(
        [
            File("images/users/used.png", 60),
            File("images/users/stray.png", 60),
            File("images/products/stray.png", 60)
        ]);

        var result = await Service(new StaleImageCleanupOptions { DryRun = false }).RunAsync(CancellationToken.None);

        // Customer stray file + customer unreferenced row only.
        result.Deleted.ShouldBe(2);
        await _storage.Received(1).DeleteAsync("/images/users/stray.png", Arg.Any<CancellationToken>());
        await _storage.Received(1).DeleteAsync("/images/users/gone.png", Arg.Any<CancellationToken>());
        await _storage.ReceivedWithAnyArgs(2).DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync(i => i.ImageUrl.Contains("products"))).ShouldBe(2);
    }

    [Fact]
    public async Task Scope_FileInOtherCategoryUsedByARow_StaysEvenIfScopeChanges()
    {
        await SeedImageAsync("/images/products/used.png", 60, referenced: true);
        await SeedImageAsync("/images/users/used.png", 60, referenced: true);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns(
            [File("images/products/used.png", 60), File("images/users/used.png", 60)]);

        var result = await Service(new StaleImageCleanupOptions { DryRun = false }).RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(0);
    }

    [Fact]
    public void Scope_DefaultIsUsersOnly()
    {
        new StaleImageCleanupOptions().Categories.ShouldBe(["users"]);
    }

    // ---- rows whose file is gone ---------------------------------------------------------------

    private Task SeedLinkedAsync(string url, int ageDays, out Guid productId)
    {
        productId = Guid.NewGuid();
        var image = new Image { ImageId = Guid.NewGuid(), ImageUrl = url, UploadedAt = DateTime.UtcNow.AddDays(-ageDays) };
        return TestDb.SaveAsync(_dbName, image, new ProductImage { ProductId = productId, ImageId = image.ImageId });
    }

    [Fact]
    public async Task UsedRowWithMissingFile_LinkAndRowAreRemoved()
    {
        await SeedLinkedAsync("/images/products/lost.png", 60, out _);
        await SeedLinkedAsync("/images/products/fine.png", 60, out var fineProduct);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/fine.png", 60)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.MissingFileRows.ShouldBe(1);
        result.Deleted.ShouldBe(1);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.SingleAsync()).ImageUrl.ShouldBe("/images/products/fine.png");
        (await db.ProductImages.SingleAsync()).ProductId.ShouldBe(fineProduct);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    [Fact]
    public async Task UsedRowWithMissingFile_RecentIsKept()
    {
        await SeedLinkedAsync("/images/products/lost.png", 2, out _);
        await SeedLinkedAsync("/images/products/fine.png", 60, out _);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/fine.png", 60)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.MissingFileRows.ShouldBe(0);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task UsedRowWithMissingFile_EmptyListing_IsNotTrusted()
    {
        await SeedLinkedAsync("/images/products/lost.png", 60, out _);

        var result = await Service().RunAsync(CancellationToken.None);

        result.MissingFileRows.ShouldBe(0);
        await using var db = TestDb.Create(_dbName);
        (await db.ProductImages.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task UsedRowWithMissingFile_NothingMatches_IsNotTrusted()
    {
        await SeedLinkedAsync("/odd/shape/lost.png", 60, out _);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/other.png", 60)]);

        var result = await Service().RunAsync(CancellationToken.None);

        result.MissingFileRows.ShouldBe(0);
        await using var db = TestDb.Create(_dbName);
        (await db.ProductImages.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task UsedRowWithMissingFile_DryRunAndOptionOff_ChangeNothing()
    {
        await SeedLinkedAsync("/images/products/lost.png", 60, out _);
        await SeedLinkedAsync("/images/products/fine.png", 60, out _);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/fine.png", 60)]);

        var dry = await Service(new StaleImageCleanupOptions { Categories = [], DryRun = true }).RunAsync(CancellationToken.None);
        var off = await Service(new StaleImageCleanupOptions { Categories = [], DryRun = false, RemoveRowsWithMissingFile = false }).RunAsync(CancellationToken.None);

        dry.MissingFileRows.ShouldBe(1);
        off.MissingFileRows.ShouldBe(0);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(2);
        (await db.ProductImages.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task OldUnreferencedRow_DeletesFileThenRow()
    {
        await SeedImageAsync("/images/products/gone.png", 60, referenced: false);

        var result = await Service().RunAsync(CancellationToken.None);

        result.OrphanRows.ShouldBe(1);
        result.Deleted.ShouldBe(1);
        await _storage.Received(1).DeleteAsync("/images/products/gone.png", Arg.Any<CancellationToken>());
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task RecentUnreferencedRow_IsKept()
    {
        await SeedImageAsync("/images/products/saving.png", 1, referenced: false);

        var result = await Service().RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(0);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task OldReferencedRow_IsKept()
    {
        await SeedImageAsync("/images/products/used.png", 400, referenced: true);

        var result = await Service().RunAsync(CancellationToken.None);

        result.OrphanRows.ShouldBe(0);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    [Fact]
    public async Task RetentionDaysZero_DoesNothing()
    {
        await SeedImageAsync("/images/products/gone.png", 600, referenced: false);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/old.png", 600)]);

        var result = await Service(new StaleImageCleanupOptions { Categories = [], DryRun = false, RetentionDays = 0 }).RunAsync(CancellationToken.None);

        result.Skipped.ShouldBeTrue();
        await _storage.DidNotReceiveWithAnyArgs().ListAsync(default);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
    }

    [Fact]
    public async Task DryRun_DeletesNothingButCounts()
    {
        await SeedImageAsync("/images/products/gone.png", 60, referenced: false);
        await SeedImageAsync("/images/products/used.png", 60, referenced: true);
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/products/old.png", 60), File("images/products/used.png", 60)]);

        var result = await Service(new StaleImageCleanupOptions { Categories = [], DryRun = true }).RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(2);
        await _storage.DidNotReceiveWithAnyArgs().DeleteAsync(default, default);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task DeleteCap_StopsTheRun()
    {
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns(
            [File("images/a.png", 60), File("images/b.png", 61), File("images/c.png", 62)]);

        var result = await Service(new StaleImageCleanupOptions { Categories = [], DryRun = false, MaxDeletesPerRun = 2 }).RunAsync(CancellationToken.None);

        result.Deleted.ShouldBe(2);
        result.CapReached.ShouldBeTrue();
        await _storage.ReceivedWithAnyArgs(2).DeleteAsync(default, default);
    }

    [Fact]
    public async Task FailingDelete_DoesNotStopTheOthers()
    {
        _storage.ListAsync(Arg.Any<CancellationToken>()).Returns([File("images/a.png", 62), File("images/b.png", 61)]);
        _storage.DeleteAsync("/images/a.png", Arg.Any<CancellationToken>()).Returns(_ => Task.FromException(new IOException("locked")));

        var result = await Service().RunAsync(CancellationToken.None);

        result.Failed.ShouldBe(1);
        result.Deleted.ShouldBe(1);
        await _storage.Received(1).DeleteAsync("/images/b.png", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task FailingFileDelete_KeepsTheRowForNextRun()
    {
        await SeedImageAsync("/images/products/gone.png", 60, referenced: false);
        _storage.DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(_ => Task.FromException(new IOException("locked")));

        var result = await Service().RunAsync(CancellationToken.None);

        result.Failed.ShouldBe(1);
        await using var db = TestDb.Create(_dbName);
        (await db.Images.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Run_SavesStateThatGetLastRunReadsBack()
    {
        (await Service().GetLastRunAsync(CancellationToken.None)).ShouldBeNull();

        await Service().RunAsync(CancellationToken.None);
        var last = await Service().GetLastRunAsync(CancellationToken.None);

        last.ShouldNotBeNull();
        last.DryRun.ShouldBeFalse();
    }

    // ---- central reference list -------------------------------------------------------------

    [Fact]
    public void ImageReferences_ListsEveryEntityThatReferencesAnImage()
    {
        using var db = TestDb.Create();
        var referencing = db.Model.GetEntityTypes()
            .Where(e => e.ClrType != typeof(Image)
                && e.GetForeignKeys().Any(fk => fk.PrincipalEntityType.ClrType == typeof(Image)))
            .Select(e => e.ClrType)
            .ToList();

        referencing.ShouldNotBeEmpty();
        foreach (var type in referencing)
        {
            ImageReferences.ReferencingEntities.ShouldContain(type, $"{type.Name} references Image but is missing from ImageReferences.");
        }
    }

    [Fact]
    public void ImageReferences_Unreferenced_CoversEveryListedEntity()
    {
        // Each entity in the list needs a navigation on Image that the Unreferenced query checks.
        foreach (var type in ImageReferences.ReferencingEntities)
        {
            typeof(Image).GetProperty(type.Name).ShouldNotBeNull($"Image has no navigation for {type.Name}.");
        }
    }

    // ---- scheduler (cold start) --------------------------------------------------------------

    private StaleImageCleanupScheduler Scheduler(IStaleImageCleanupService service, StaleImageCleanupOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton(service);
        return new StaleImageCleanupScheduler(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            NullLogger<StaleImageCleanupScheduler>.Instance);
    }

    private static async Task RunBrieflyAsync(StaleImageCleanupScheduler scheduler)
    {
        await scheduler.StartAsync(CancellationToken.None);
        await Task.Delay(300);
        await scheduler.StopAsync(CancellationToken.None);
    }

    // RunAtHour 0:00 UTC means "today's run time has always passed", so a cold start must catch up.
    private static StaleImageCleanupOptions UtcMidnight() => new() { TimeZoneId = "UTC", RunAtHour = 0, RunAtMinute = 0 };

    [Fact]
    public async Task Scheduler_ColdStart_NeverRan_RunsImmediately()
    {
        var service = Substitute.For<IStaleImageCleanupService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns((StaleImageCleanupResult?)null);

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_ColdStart_LastRunYesterday_CatchesUp()
    {
        var service = Substitute.For<IStaleImageCleanupService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>())
            .Returns(new StaleImageCleanupResult(DateTimeOffset.UtcNow.AddDays(-1), false, 30, 0, 0, 0, 0, false, false));

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_AlreadyRanToday_DoesNotRunAgain()
    {
        var service = Substitute.For<IStaleImageCleanupService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>())
            .Returns(new StaleImageCleanupResult(DateTimeOffset.UtcNow, false, 30, 0, 0, 0, 0, false, false));

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.DidNotReceive().RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_StartedBeforeRunTime_WaitsForIt()
    {
        var service = Substitute.For<IStaleImageCleanupService>();
        // Run time is one minute from now in UTC (hour/minute wrap handled), so it is not yet due.
        var later = DateTimeOffset.UtcNow.AddMinutes(1);
        if (later.Date != DateTimeOffset.UtcNow.Date)
        {
            return; // too close to midnight UTC for this check to mean anything
        }

        var options = new StaleImageCleanupOptions { Categories = [], TimeZoneId = "UTC", RunAtHour = later.Hour, RunAtMinute = later.Minute };

        await RunBrieflyAsync(Scheduler(service, options));

        await service.DidNotReceive().RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_Disabled_DoesNothing()
    {
        var service = Substitute.For<IStaleImageCleanupService>();

        await RunBrieflyAsync(Scheduler(service, new StaleImageCleanupOptions { Categories = [], Enabled = false, TimeZoneId = "UTC" }));

        await service.DidNotReceiveWithAnyArgs().RunAsync(default);
        await service.DidNotReceiveWithAnyArgs().GetLastRunAsync(default);
    }

    [Fact]
    public async Task Scheduler_FailedRun_IsRetriedNotLost()
    {
        var service = Substitute.For<IStaleImageCleanupService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns((StaleImageCleanupResult?)null);
        service.RunAsync(Arg.Any<CancellationToken>()).Returns<Task<StaleImageCleanupResult>>(_ => throw new IOException("storage down"));

        var scheduler = Scheduler(service, UtcMidnight());
        await RunBrieflyAsync(scheduler);

        // The failure is swallowed and the loop waits to retry; the host is not crashed.
        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Options_Defaults_AreSafe()
    {
        var o = new StaleImageCleanupOptions();

        o.RetentionDays.ShouldBe(30);
        o.DryRun.ShouldBeTrue();
        o.RunAtHour.ShouldBe(2);
        o.TimeZoneId.ShouldBe("Asia/Manila");
        StaleImageCleanupOptions.SectionName.ShouldBe("StaleImageCleanup");
    }
}
