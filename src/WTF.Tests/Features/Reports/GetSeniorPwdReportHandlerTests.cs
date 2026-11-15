using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Reports;

public class GetSeniorPwdReportHandlerTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private GetSeniorPwdReportHandler Handler(string role = AppRoles.Admin, string? accept = null) =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), role, "Asia/Manila", accept));

    private static GetSeniorPwdReportQuery FullIdQuery() => Query() with { IncludeFullIdNumbers = true };

    private static GetSeniorPwdReportQuery Query() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    private async Task SeedAsync(int status = Completed)
    {
        await using var db = TestDb.Create(_dbName);
        Basics(db);
        var p = Product(db, "Latte", 100m);
        var order = Sale(db, p, Noon, 71.43m, status);
        db.OrderSeniorPwdDiscounts.Add(new OrderSeniorPwdDiscount
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Type = (byte)SeniorPwdTypeEnum.Pwd,
            IdNumber = "PWD-12345678",
            CustomerName = "Lola Remedios",
            CoveredAmount = 100m,
            VatExemptAmount = 10.71m,
            DiscountAmount = 17.86m,
            RecordedBy = order.CreatedBy,
            CreatedAt = Noon,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Handle_CompletedOrder_ListsOneRowPerPersonWithTheNetAmount()
    {
        await SeedAsync();

        var row = (await Handler().Handle(Query(), default)).ShouldHaveSingleItem();

        row.Type.ShouldBe("PWD");
        row.CustomerName.ShouldBe("Lola Remedios");
        row.CoveredAmount.ShouldBe(100m);
        row.VatExemptAmount.ShouldBe(10.71m);
        row.DiscountAmount.ShouldBe(17.86m);
        row.NetAmount.ShouldBe(71.43m);
        row.OrderedAt.ShouldBe(new DateTime(2026, 3, 10, 12, 0, 0));
    }

    [Fact]
    public async Task Handle_RefundedOrder_StaysInTheListMarkedRefunded_SoTheTotalMatchesTheSalesColumns()
    {
        await SeedAsync(Refunded);

        var row = (await Handler().Handle(Query(), default)).ShouldHaveSingleItem();

        row.Status.ShouldBe("Refunded");
        row.NetAmount.ShouldBe(71.43m);
    }

    [Fact]
    public async Task Handle_CompletedOrder_IsMarkedSold()
    {
        await SeedAsync();

        (await Handler().Handle(Query(), default)).ShouldHaveSingleItem().Status.ShouldBe("Sold");
    }

    [Theory]
    [InlineData(Cancelled)]
    [InlineData(Pending)]
    public async Task Handle_OrderThatIsNotASale_IsLeftOut(int status)
    {
        await SeedAsync(status);

        (await Handler().Handle(Query(), default)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_OnScreen_MasksTheIdToItsLastFourCharacters()
    {
        await SeedAsync();

        var row = (await Handler().Handle(Query(), default)).ShouldHaveSingleItem();

        row.IdNumber.ShouldBe("********5678");
    }

    [Fact]
    public async Task Handle_WhenTheEndpointAsksForFullIds_ShowsTheFullId()
    {
        await SeedAsync();

        var row = (await Handler().Handle(FullIdQuery(), default)).ShouldHaveSingleItem();

        row.IdNumber.ShouldBe("PWD-12345678");
    }

    [Theory]
    [InlineData(AppRoles.Admin, "application/pdf")]
    [InlineData(AppRoles.Owner, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [InlineData(AppRoles.Cashier, "application/pdf")]
    public async Task Handle_WithoutTheFlag_NeverUnmasks_WhateverTheCallerOrAcceptHeaderSays(string role, string accept)
    {
        await SeedAsync();

        var row = (await Handler(role, accept).Handle(Query(), default)).ShouldHaveSingleItem();

        row.IdNumber.ShouldBe("********5678");
        System.Text.Json.JsonSerializer.Serialize(row).ShouldNotContain("12345678");
    }
}

public class DailyCloseSeniorPwdTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    [Fact]
    public async Task Handle_OrderWithTheDiscount_AddsTheSeniorPwdAndVatExemptRowsAndKeepsGrossAtListPrice()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var p = Product(db, "Latte", 100m);
            var order = Sale(db, p, Noon, 100m);
            var item = order.OrderItems.Single();
            item.SeniorPwdVatExempt = 10.71m;
            item.SeniorPwdDiscount = 17.86m;
            await db.SaveChangesAsync();
        }

        var handler = new GetDailyCloseReportHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

        var rows = await handler.Handle(new GetDailyCloseReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) }, default);

        rows.Single(r => r.Label == "Gross sales").Amount.ShouldBe(100m);
        rows.Single(r => r.Label == "Senior/PWD discount").Amount.ShouldBe(17.86m);
        rows.Single(r => r.Label == "VAT-exempt sales").Amount.ShouldBe(10.71m);
        rows.Single(r => r.Label == "Net sales").Amount.ShouldBe(71.43m);
    }

    [Fact]
    public async Task Handle_NoDiscountGiven_AddsNoSeniorPwdRows()
    {
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            Sale(db, Product(db, "Latte", 100m), Noon, 100m);
            await db.SaveChangesAsync();
        }

        var handler = new GetDailyCloseReportHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

        var rows = await handler.Handle(new GetDailyCloseReportQuery { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) }, default);

        rows.ShouldNotContain(r => r.Label == "Senior/PWD discount");
    }
}
