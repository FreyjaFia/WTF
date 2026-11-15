using Microsoft.AspNetCore.Http;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Reports.DTOs;

namespace WTF.Tests.Endpoints;

public class SeniorPwdReportEndpointTests : IDisposable
{
    private const string Excel = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string Query = "fromDate=2026-01-01&toDate=2026-01-31";

    private readonly EndpointTestHost _host = new();

    public SeniorPwdReportEndpointTests()
    {
        _host.Sender
            .Send(Arg.Any<GetSeniorPwdReportQuery>(), Arg.Any<CancellationToken>())
            .Returns(new List<SeniorPwdReportRowDto>());
    }

    public void Dispose() => _host.Dispose();

    private static ClaimsPrincipal UserInRole(string role) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));

    private GetSeniorPwdReportQuery SentQuery() =>
        _host.Sender.ReceivedCalls()
            .Select(call => call.GetArguments()[0])
            .OfType<GetSeniorPwdReportQuery>()
            .Single();

    [Fact]
    public async Task Request_WithoutIncludeFullIdNumbers_Returns200AndMasksIds()
    {
        var (status, _) = await _host.InvokeAsync("GET", "/api/reports/senior-pwd", query: Query);

        status.ShouldBe(StatusCodes.Status200OK);
        SentQuery().IncludeFullIdNumbers.ShouldNotBe(true);
    }

    [Fact]
    public async Task Request_AskingForFullIds_StillMasksThemOnScreen()
    {
        var (status, _) = await _host.InvokeAsync(
            "GET", "/api/reports/senior-pwd", query: Query + "&includeFullIdNumbers=true", user: UserInRole(AppRoles.Owner));

        status.ShouldBe(StatusCodes.Status200OK);
        SentQuery().IncludeFullIdNumbers.ShouldNotBe(true);
    }

    [Fact]
    public async Task Export_WithoutThePermission_MasksIds()
    {
        var (status, _) = await _host.InvokeAsync(
            "GET", "/api/reports/senior-pwd", query: Query + "&includeFullIdNumbers=true",
            user: UserInRole(AppRoles.AdminViewer), headers: new Dictionary<string, string> { ["Accept"] = Excel });

        status.ShouldBe(StatusCodes.Status200OK);
        SentQuery().IncludeFullIdNumbers.ShouldNotBe(true);
    }

    [Fact]
    public async Task Export_WithThePermission_AsksForFullIds()
    {
        var (status, _) = await _host.InvokeAsync(
            "GET", "/api/reports/senior-pwd", query: Query,
            user: UserInRole(AppRoles.Owner), headers: new Dictionary<string, string> { ["Accept"] = Excel });

        status.ShouldBe(StatusCodes.Status200OK);
        SentQuery().IncludeFullIdNumbers.ShouldBe(true);
    }
}
