using Microsoft.AspNetCore.Http;
using NSubstitute;
using WTF.Api.Features.Audit;
using WTF.Api.Features.Audit.DTOs;

namespace WTF.Tests.Endpoints;

public class AuditPagingTests : IDisposable
{
    private const string Excel = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string Pdf = "application/pdf";

    private readonly EndpointTestHost _host = new();

    public AuditPagingTests()
    {
        _host.Sender
            .Send(Arg.Any<GetAuditLogsQuery>(), Arg.Any<CancellationToken>())
            .Returns(new PagedResultDto<AuditLogDto>([], 1, 1, 0));
    }

    public void Dispose() => _host.Dispose();

    private GetAuditLogsQuery SentQuery() =>
        _host.Sender.ReceivedCalls()
            .Select(call => call.GetArguments()[0])
            .OfType<GetAuditLogsQuery>()
            .Single();

    [Fact]
    public async Task ListRequest_ForwardsThePageAndPageSize()
    {
        var (status, _) = await _host.InvokeAsync("GET", "/api/audit-logs/", query: "page=3&pageSize=25");

        status.ShouldBe(StatusCodes.Status200OK);
        SentQuery().Page.ShouldBe(3);
        SentQuery().PageSize.ShouldBe(25);
    }

    [Fact]
    public async Task ListRequest_WithoutPaging_StaysUnpaged()
    {
        await _host.InvokeAsync("GET", "/api/audit-logs/");

        SentQuery().IsPaged.ShouldBeFalse();
    }

    [Theory]
    [InlineData(Excel)]
    [InlineData(Pdf)]
    public async Task ExportRequest_IgnoresPagingSoTheFileHoldsEveryLog(string accept)
    {
        await _host.InvokeAsync(
            "GET",
            "/api/audit-logs/",
            query: "page=2&pageSize=10&action=Create",
            headers: new Dictionary<string, string> { ["Accept"] = accept });

        var sent = SentQuery();
        sent.Page.ShouldBeNull();
        sent.PageSize.ShouldBeNull();
        sent.IsPaged.ShouldBeFalse();
        sent.Action.ShouldBe("Create"); // filters are kept
    }

    [Fact]
    public void Query_IsPagedWhenEitherValueIsGiven()
    {
        new GetAuditLogsQuery().IsPaged.ShouldBeFalse();
        new GetAuditLogsQuery { Page = 2 }.IsPaged.ShouldBeTrue();
        new GetAuditLogsQuery { PageSize = 10 }.IsPaged.ShouldBeTrue();
    }

    [Fact]
    public void PageSizeLimits_AreTenByDefaultAndCappedAtOneHundred()
    {
        GetAuditLogsQuery.DefaultPageSize.ShouldBe(10);
        GetAuditLogsQuery.MaxPageSize.ShouldBe(100);
    }
}
