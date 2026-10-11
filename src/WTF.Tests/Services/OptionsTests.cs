using WTF.Api.Features.Reports;
using WTF.Api.Services;

namespace WTF.Tests.Services;

public class OptionsTests
{
    [Fact]
    public void SchedulerOptions_Defaults()
    {
        var o = new MonthlyReportWorkbookSchedulerOptions();

        o.Enabled.ShouldBeTrue();
        o.TimeZoneId.ShouldBe("Asia/Manila");
        o.RunAtHour.ShouldBe(0);
        o.RunAtMinute.ShouldBe(0);
        o.RetryCount.ShouldBe(3);
        o.RetryDelayMinutes.ShouldBe(15);
        MonthlyReportWorkbookSchedulerOptions.SectionName.ShouldBe("MonthlyReportWorkbookScheduler");
    }

    [Fact]
    public void FcmOptions_DefaultsAreNullAndSectionName()
    {
        var o = new FcmOptions();

        o.ProjectId.ShouldBeNull();
        o.ServiceAccountJson.ShouldBeNull();
        o.ServiceAccountJsonPath.ShouldBeNull();
        FcmOptions.SectionName.ShouldBe("Fcm");
    }

    [Fact]
    public void HuaweiPushOptions_DefaultsAreNullAndSectionName()
    {
        var o = new HuaweiPushOptions();

        o.AppId.ShouldBeNull();
        o.AppSecret.ShouldBeNull();
        o.OAuthEndpoint.ShouldBeNull();
        o.PushEndpoint.ShouldBeNull();
        HuaweiPushOptions.SectionName.ShouldBe("HuaweiPush");
    }
}
