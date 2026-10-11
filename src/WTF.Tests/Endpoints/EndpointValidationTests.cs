using Microsoft.AspNetCore.Http;
using NSubstitute;

namespace WTF.Tests.Endpoints;

/// <summary>Request validation done inside the endpoint delegates, before any handler or database is touched.</summary>
public class EndpointValidationTests : IDisposable
{
    private readonly EndpointTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private static Dictionary<string, object> Id(Guid id, string name = "id") => new() { [name] = id };

    [Theory]
    [InlineData("/api/customers/{id:guid}")]
    [InlineData("/api/products/{id:guid}")]
    [InlineData("/api/items/{id:guid}")]
    [InlineData("/api/orders/{id:guid}")]
    [InlineData("/api/orders/{id:guid}/override")]
    public async Task Put_WithBodyIdDifferentFromRouteId_ReturnsBadRequest(string pattern)
    {
        var (status, body) = await _host.InvokeAsync(
            "PUT",
            pattern,
            Id(Guid.NewGuid()),
            jsonBody: new { id = Guid.NewGuid() });

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("mismatch");
        _host.Sender.ReceivedCalls().ShouldBeEmpty();
    }

    [Theory]
    [InlineData("/api/management/promotions/fixed-bundles/{promotionId:guid}")]
    [InlineData("/api/management/promotions/mix-match/{promotionId:guid}")]
    [InlineData("/api/management/promotions/discounted-products/{promotionId:guid}")]
    public async Task PromotionPut_WithMismatchedId_ReturnsBadRequest(string pattern)
    {
        var (status, body) = await _host.InvokeAsync(
            "PUT",
            pattern,
            Id(Guid.NewGuid(), "promotionId"),
            jsonBody: new { promotionId = Guid.NewGuid(), name = "x" });

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("mismatch");
        _host.Sender.ReceivedCalls().ShouldBeEmpty();
    }

    [Theory]
    [InlineData("", "fromDate and toDate are required.")]
    [InlineData("fromDate=2025-01-05", "fromDate and toDate are required.")]
    [InlineData("toDate=2025-01-05", "fromDate and toDate are required.")]
    [InlineData("fromDate=0001-01-01&toDate=2025-01-05", "fromDate and toDate are required.")]
    [InlineData("fromDate=2025-01-05&toDate=0001-01-01", "fromDate and toDate are required.")]
    [InlineData("fromDate=2025-02-01&toDate=2025-01-01", "toDate must be greater than or equal to fromDate.")]
    public async Task DailySalesReport_RejectsAnInvalidDateRange(string query, string expected)
    {
        var (status, body) = await _host.InvokeAsync("GET", "/api/reports/daily-sales", query: query);

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain(expected);
        _host.Sender.ReceivedCalls().ShouldBeEmpty();
    }

    [Theory]
    [InlineData("/api/reports/product-sales")]
    [InlineData("/api/reports/payments")]
    [InlineData("/api/reports/hourly")]
    [InlineData("/api/reports/staff")]
    public async Task OtherReports_RejectAMissingDateRangeWithAReadableMessage(string pattern)
    {
        var (status, body) = await _host.InvokeAsync("GET", pattern);

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("fromDate and toDate are required.");
        _host.Sender.ReceivedCalls().ShouldBeEmpty();
    }

    [Theory]
    [InlineData("/api/reports/product-sales")]
    [InlineData("/api/reports/payments")]
    [InlineData("/api/reports/hourly")]
    [InlineData("/api/reports/staff")]
    public async Task OtherReports_RejectAReversedDateRange(string pattern)
    {
        var (status, body) = await _host.InvokeAsync("GET", pattern, query: "fromDate=2025-02-01&toDate=2025-01-01");

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("toDate must be greater than or equal to fromDate.");
    }

    [Fact]
    public async Task DailySalesReport_RejectsAnUnknownGroupBy()
    {
        var (status, body) = await _host.InvokeAsync(
            "GET", "/api/reports/daily-sales", query: "fromDate=2025-01-01&toDate=2025-01-31&groupBy=99");

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("groupBy must be one of");
    }

    [Theory]
    [InlineData("year=1999&month=5", "year must be between 2000 and 2100.")]
    [InlineData("year=2101&month=5", "year must be between 2000 and 2100.")]
    [InlineData("year=2025&month=0", "month must be between 1 and 12.")]
    [InlineData("year=2025&month=13", "month must be between 1 and 12.")]
    public async Task MonthlyWorkbookStatus_RejectsAnInvalidMonth(string query, string expected)
    {
        var (status, body) = await _host.InvokeAsync("GET", "/api/reports/monthly-workbook/status", query: query);

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain(expected);
    }

    [Theory]
    [InlineData("", "web", "token is required.")]
    [InlineData("   ", "web", "token is required.")]
    [InlineData("abc", "", "platform must be")]
    [InlineData("abc", "windows", "platform must be")]
    public async Task PushSubscribe_RejectsBadInput(string token, string platform, string expected)
    {
        var (status, body) = await _host.InvokeAsync(
            "POST", "/api/push/subscribe", jsonBody: new { token, platform });

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain(expected);
    }

    [Fact]
    public async Task PushUnsubscribe_RequiresAToken()
    {
        var (status, body) = await _host.InvokeAsync(
            "POST", "/api/push/unsubscribe", jsonBody: new { token = " " });

        status.ShouldBe(StatusCodes.Status400BadRequest);
        body.ShouldContain("token is required.");
    }

    [Fact]
    public async Task Login_WhenTheHandlerReturnsNothing_IsUnauthorized()
    {
        var (status, _) = await _host.InvokeAsync(
            "POST", "/api/auth/login", jsonBody: new { username = "al", password = "wrong" });

        status.ShouldBe(StatusCodes.Status401Unauthorized);
    }
}
