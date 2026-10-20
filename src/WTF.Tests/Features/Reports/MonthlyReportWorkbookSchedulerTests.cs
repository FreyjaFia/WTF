using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using System.Reflection;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;
using WTF.Api.Services;

namespace WTF.Tests.Features.Reports;

/// <summary>
/// The scheduler reads the system clock directly (no seam), so ExecuteAsync is driven in real time with
/// a UTC schedule and expectations are derived from the clock at the moment the test runs. The long sleep
/// between runs is never waited out: the host is stopped as soon as the first catch-up pass has finished.
/// </summary>
public class MonthlyReportWorkbookSchedulerTests
{
    private readonly IMonthlyReportWorkbookService _service = Substitute.For<IMonthlyReportWorkbookService>();

    private MonthlyReportWorkbookScheduler Create(MonthlyReportWorkbookSchedulerOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton(_service);
        var provider = services.BuildServiceProvider();
        return new MonthlyReportWorkbookScheduler(
            provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            NullLogger<MonthlyReportWorkbookScheduler>.Instance);
    }

    private static MonthlyReportWorkbookSchedulerOptions UtcOptions(bool enabled = true) => new()
    {
        Enabled = enabled,
        TimeZoneId = "UTC"
    };

    private static MonthlyReportWorkbookStatusDto Status(DateTime now, bool exists, DateTime? generatedAtUtc) =>
        new(now.Year, now.Month, exists, "x.xlsx", generatedAtUtc, exists ? 10 : null);

    /// <summary>Runs the scheduler until <paramref name="isDone"/> is true (or 5 s pass), then stops it.</summary>
    private static async Task RunUntilAsync(MonthlyReportWorkbookScheduler scheduler, Func<bool> isDone)
    {
        await scheduler.StartAsync(CancellationToken.None);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!isDone() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(10);
        }

        await scheduler.StopAsync(CancellationToken.None);
    }

    private static T Invoke<T>(string method, params object[] args)
    {
        var info = typeof(DailyCatchUpScheduler).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static)!;
        return (T)info.Invoke(null, args)!;
    }

    // ---- options -----------------------------------------------------------------------------

    [Fact]
    public void Options_Defaults_RunDailyAtMidnightManilaWithRetries()
    {
        var options = new MonthlyReportWorkbookSchedulerOptions();

        options.Enabled.ShouldBeTrue();
        options.TimeZoneId.ShouldBe("Asia/Manila");
        options.RunAtHour.ShouldBe(0);
        options.RunAtMinute.ShouldBe(0);
        options.RetryCount.ShouldBe(3);
        options.RetryDelayMinutes.ShouldBe(15);
        MonthlyReportWorkbookSchedulerOptions.SectionName.ShouldBe("MonthlyReportWorkbookScheduler");
    }

    // ---- enabled / disabled ------------------------------------------------------------------

    [Fact]
    public async Task ExecuteAsync_Disabled_DoesNothing()
    {
        var scheduler = Create(UtcOptions(enabled: false));

        await scheduler.StartAsync(CancellationToken.None);
        await scheduler.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(5));
        await scheduler.StopAsync(CancellationToken.None);

        await _service.DidNotReceiveWithAnyArgs().GetStatusAsync(default, default, default);
        await _service.DidNotReceiveWithAnyArgs().GenerateAsync(default, default, default, default);
        await _service.DidNotReceiveWithAnyArgs()
            .GenerateThroughDateAsync(default, default, default, default, default, default);
    }

    [Fact]
    public async Task ExecuteAsync_Enabled_StopsPromptlyWhenCancelledWhileSleeping()
    {
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(DateTime.UtcNow, true, DateTime.UtcNow)));
        var scheduler = Create(UtcOptions());

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Any());

        scheduler.ExecuteTask!.IsCompletedSuccessfully.ShouldBeTrue();
    }

    // ---- catch-up pass at start-up -----------------------------------------------------------

    [Fact]
    public async Task ExecuteAsync_FileAlreadyGeneratedToday_DoesNotRegenerate()
    {
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(DateTime.UtcNow, true, DateTime.UtcNow)));
        var scheduler = Create(UtcOptions());

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Any());
        await Task.Delay(100);

        await _service.DidNotReceiveWithAnyArgs()
            .GenerateThroughDateAsync(default, default, default, default, default, default);
    }

    [Fact]
    public async Task ExecuteAsync_FileGeneratedYesterday_RegeneratesThroughYesterdayAtEndOfDay()
    {
        var now = DateTime.UtcNow;
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(now, true, now.AddDays(-1))));
        var scheduler = Create(UtcOptions());

        var yesterday = now.Date.AddDays(-1);
        var firstOfMonthToday = now.Day == 1;

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls()
            .Any(c => c.GetMethodInfo().Name == nameof(IMonthlyReportWorkbookService.GenerateThroughDateAsync))
            || (firstOfMonthToday && _service.ReceivedCalls().Count() >= 2));

        if (firstOfMonthToday)
        {
            // Nothing has been completed yet this month, so there is nothing to catch up on.
            await _service.DidNotReceiveWithAnyArgs()
                .GenerateThroughDateAsync(default, default, default, default, default, default);
            return;
        }

        await _service.Received(1).GenerateThroughDateAsync(
            now.Year,
            now.Month,
            yesterday,
            "UTC",
            new DateTime(yesterday.Year, yesterday.Month, yesterday.Day, 23, 59, 0, DateTimeKind.Unspecified),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ExecuteAsync_FileMissing_GeneratesCurrentMonthThroughYesterday()
    {
        var now = DateTime.UtcNow;
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(now, false, null)));
        var scheduler = Create(UtcOptions());

        var firstOfMonthToday = now.Day == 1;
        await RunUntilAsync(scheduler, () => _service.ReceivedCalls()
            .Any(c => c.GetMethodInfo().Name == nameof(IMonthlyReportWorkbookService.GenerateThroughDateAsync))
            || (firstOfMonthToday && _service.ReceivedCalls().Count() >= 3));

        var calls = _service.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IMonthlyReportWorkbookService.GenerateThroughDateAsync))
            .ToList();
        if (firstOfMonthToday)
        {
            calls.ShouldBeEmpty();
        }
        else
        {
            var call = calls.ShouldHaveSingleItem();
            call.GetArguments()[0].ShouldBe(now.Year);
            call.GetArguments()[1].ShouldBe(now.Month);
            ((DateTime)call.GetArguments()[2]!).ShouldBe(now.Date.AddDays(-1));
        }
    }

    [Fact]
    public async Task ExecuteAsync_FirstOfMonthAndPreviousMonthMissing_GeneratesPreviousMonthInSchedulerTimeZone()
    {
        var now = DateTime.UtcNow;
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(now, false, null)));
        var scheduler = Create(UtcOptions());

        var firstOfMonthToday = now.Day == 1;
        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Count() >= (firstOfMonthToday ? 3 : 2));
        await Task.Delay(100);

        var previous = now.AddMonths(-1);
        var generateCalls = _service.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IMonthlyReportWorkbookService.GenerateAsync))
            .ToList();
        if (firstOfMonthToday)
        {
            var call = generateCalls.ShouldHaveSingleItem();
            call.GetArguments()[0].ShouldBe(previous.Year);
            call.GetArguments()[1].ShouldBe(previous.Month);
            call.GetArguments()[2].ShouldBe("UTC");
        }
        else
        {
            generateCalls.ShouldBeEmpty();
        }
    }

    [Fact]
    public async Task ExecuteAsync_FirstOfMonthAndPreviousMonthExists_DoesNotRegeneratePreviousMonth()
    {
        var now = DateTime.UtcNow;
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(now, true, now)));
        var scheduler = Create(UtcOptions());

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Count() >= (now.Day == 1 ? 2 : 1));
        await Task.Delay(100);

        await _service.DidNotReceiveWithAnyArgs().GenerateAsync(default, default, default, default);
    }

    [Fact]
    public async Task ExecuteAsync_UnknownTimeZone_FallsBackToUtc()
    {
        var now = DateTime.UtcNow;
        _service.GetStatusAsync(default, default, default).ReturnsForAnyArgs(ci =>
            Task.FromResult(Status(now, true, now)));
        var scheduler = Create(new MonthlyReportWorkbookSchedulerOptions { TimeZoneId = "Not/AZone" });

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Any());

        // The status month is read in the scheduler's zone (UTC fallback).
        await _service.Received().GetStatusAsync(now.Year, now.Month, Arg.Any<CancellationToken>());
    }

    // ---- failure behavior --------------------------------------------------------------------

    [Fact]
    public async Task ExecuteAsync_GenerationThrows_SchedulerKeepsRunningAndStopsCleanly()
    {
        _service.GetStatusAsync(default, default, default)
            .ReturnsForAnyArgs(_ => Task.FromException<MonthlyReportWorkbookStatusDto>(new InvalidOperationException("storage down")));
        var scheduler = Create(UtcOptions());

        await RunUntilAsync(scheduler, () => _service.ReceivedCalls().Any());

        scheduler.ExecuteTask!.IsFaulted.ShouldBeFalse();
        scheduler.ExecuteTask.IsCompletedSuccessfully.ShouldBeTrue();
    }

    [Fact]
    public async Task ExecuteAsync_GenerationKeepsFailing_WaitsBetweenRetries()
    {
        _service.GetStatusAsync(default, default, default)
            .ReturnsForAnyArgs(_ => Task.FromException<MonthlyReportWorkbookStatusDto>(new InvalidOperationException("storage down")));
        var scheduler = Create(new MonthlyReportWorkbookSchedulerOptions
        {
            TimeZoneId = "UTC",
            RetryCount = 3,
            RetryDelayMinutes = 15
        });

        await scheduler.StartAsync(CancellationToken.None);
        await Task.Delay(500);
        await scheduler.StopAsync(CancellationToken.None);

        // With RetryCount = 3 and a 15 minute delay, half a second can contain at most one attempt.
        _service.ReceivedCalls().Count().ShouldBeLessThanOrEqualTo(3);
    }

    // ---- GetNextDelay (private static; reached by reflection) --------------------------------

    private static TimeSpan NextDelay(string zoneId, int hour, int minute) =>
        Invoke<TimeSpan>("GetNextDelay", TimeZoneInfo.FindSystemTimeZoneById(zoneId), hour, minute);

    private static TimeSpan ExpectedDelay(TimeZoneInfo zone, int hour, int minute)
    {
        var nowUtc = DateTime.UtcNow;
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone);
        var target = nowLocal.Date.AddHours(hour).AddMinutes(minute);
        if (target <= nowLocal)
        {
            target = target.AddDays(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(target, zone) - nowUtc;
    }

    [Theory]
    [InlineData("UTC", 0, 0)]
    [InlineData("UTC", 13, 45)]
    [InlineData("UTC", 23, 59)]
    [InlineData("Asia/Manila", 0, 0)]
    [InlineData("Asia/Manila", 6, 30)]
    [InlineData("Asia/Manila", 18, 5)]
    public void GetNextDelay_RunAtTime_WaitsUntilNextOccurrenceInThatZone(string zoneId, int hour, int minute)
    {
        var actual = NextDelay(zoneId, hour, minute);
        var expected = ExpectedDelay(TimeZoneInfo.FindSystemTimeZoneById(zoneId), hour, minute);

        // Allow a few seconds for the two clock reads, and for a midnight/run-time boundary crossing.
        Math.Abs((actual - expected).TotalSeconds).ShouldBeLessThan(5);
    }

    [Theory]
    [InlineData("UTC", 0, 0)]
    [InlineData("UTC", 12, 0)]
    [InlineData("Asia/Manila", 0, 0)]
    [InlineData("Asia/Manila", 23, 59)]
    public void GetNextDelay_AnyRunAtTime_IsPositiveAndNeverMoreThanADay(string zoneId, int hour, int minute)
    {
        var delay = NextDelay(zoneId, hour, minute);

        delay.ShouldBeGreaterThan(TimeSpan.Zero);
        delay.ShouldBeLessThanOrEqualTo(TimeSpan.FromDays(1));
    }

    [Fact]
    public void GetNextDelay_RunAtTimeJustPassed_RollsToTomorrow()
    {
        // One minute ago (UTC) is always "already passed today", so the wait is just under a day -
        // except in the first minute after midnight, when "one minute ago" is yesterday and wraps to today.
        var oneMinuteAgo = DateTime.UtcNow.AddMinutes(-1);
        var delay = NextDelay("UTC", oneMinuteAgo.Hour, oneMinuteAgo.Minute);

        if (oneMinuteAgo.Date == DateTime.UtcNow.Date)
        {
            delay.ShouldBeGreaterThan(TimeSpan.FromHours(23).Add(TimeSpan.FromMinutes(58)));
        }

        delay.ShouldBeLessThanOrEqualTo(TimeSpan.FromDays(1));
    }

    [Fact]
    public void GetNextDelay_RunAtTimeLaterToday_WaitsLessThanADay()
    {
        var soon = DateTime.UtcNow.AddMinutes(10);
        var delay = NextDelay("UTC", soon.Hour, soon.Minute);

        // Normally ~10 minutes; when the +10 minutes crosses midnight it is still a short wait.
        delay.ShouldBeLessThan(TimeSpan.FromMinutes(11));
        delay.ShouldBeGreaterThan(TimeSpan.FromMinutes(8));
    }

    [Fact]
    public void GetNextDelay_InvalidRunAtHour_Throws()
    {
        var ex = Should.Throw<TargetInvocationException>(() => NextDelay("UTC", 24, 0));

        ex.InnerException.ShouldBeOfType<ArgumentOutOfRangeException>();
    }

    // ---- ResolveTimeZone (private static; reached by reflection) -----------------------------

    [Theory]
    [InlineData("", "UTC")]
    [InlineData("   ", "UTC")]
    [InlineData("Not/AZone", "UTC")]
    [InlineData("UTC", "UTC")]
    [InlineData("Asia/Manila", "Asia/Manila")]
    public void ResolveTimeZone_Id_ReturnsExpectedZone(string id, string expectedId)
    {
        var zone = Invoke<TimeZoneInfo>("ResolveTimeZone", id);

        zone.Id.ShouldBe(expectedId);
    }

    [Fact]
    public void ResolveTimeZone_WindowsIdOnAnyPlatform_Resolves()
    {
        var zone = Invoke<TimeZoneInfo>("ResolveTimeZone", "Singapore Standard Time");

        zone.BaseUtcOffset.ShouldBe(TimeSpan.FromHours(8));
    }
}
