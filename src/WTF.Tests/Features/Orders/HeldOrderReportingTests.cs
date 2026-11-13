using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Notifications;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Reports;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Orders;

public class HeldOrderReportingTests
{
    private static readonly DateTime Noon = Utc(2026, 3, 10, 4);

    private readonly string _dbName = TestDb.NewName();

    private Order SeedHeld(Product product, DateTime createdAt, decimal quoted, decimal seniorDiscount = 0m, decimal vatExempt = 0m)
    {
        using var db = TestDb.Create(_dbName);
        var order = Order(db, createdAt, 6);
        order.QuotedTotal = quoted;
        var item = Item(db, order, product, 1, quoted + seniorDiscount + vatExempt);
        item.SeniorPwdDiscount = seniorDiscount == 0m ? null : seniorDiscount;
        item.SeniorPwdVatExempt = vatExempt == 0m ? null : vatExempt;
        db.SaveChanges();
        return order;
    }

    private Product SeedBasicsAndSale(decimal saleAmount)
    {
        using var db = TestDb.Create(_dbName);
        Basics(db);
        var product = Product(db, "Burger", 100m);
        Sale(db, product, Noon, saleAmount);
        db.SaveChanges();
        return product;
    }

    private GetDailyCloseReportHandler DailyClose() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static GetDailyCloseReportQuery Day() =>
        new() { FromDate = new DateTime(2026, 3, 10), ToDate = new DateTime(2026, 3, 10) };

    [Fact]
    public async Task DailyClose_ShowsHeldSalesNextToTheSales_AndKeepsThemOutOfRevenue()
    {
        var product = SeedBasicsAndSale(200m);
        SeedHeld(product, Noon, 80m);
        SeedHeld(product, Noon.AddHours(1), 45.50m);

        var rows = await DailyClose().Handle(Day(), default);

        var sales = rows.Where(r => r.Section == "Sales").ToDictionary(r => r.Label);
        var held = sales[GetDailyCloseReportHandler.HeldOrdersLabel];
        held.OrderCount.ShouldBe(2);
        held.Amount.ShouldBe(125.50m);
        sales["Net sales"].Amount.ShouldBe(200m);
        sales["Net sales"].OrderCount.ShouldBe(1);
        sales["Gross sales"].Amount.ShouldBe(200m);
        sales.ContainsKey(GetDailyCloseReportHandler.HeldSeniorPwdLabel).ShouldBeFalse();
    }

    [Fact]
    public async Task DailyClose_ShowsTheHeldSeniorPwdDiscountOnItsOwnLine()
    {
        var product = SeedBasicsAndSale(200m);
        SeedHeld(product, Noon, 71.43m, seniorDiscount: 17.86m, vatExempt: 10.71m);

        var rows = await DailyClose().Handle(Day(), default);

        var sales = rows.Where(r => r.Section == "Sales").ToDictionary(r => r.Label);
        sales[GetDailyCloseReportHandler.HeldOrdersLabel].Amount.ShouldBe(71.43m);
        var discount = sales[GetDailyCloseReportHandler.HeldSeniorPwdLabel];
        discount.Amount.ShouldBe(17.86m);
        discount.Detail!.ShouldContain("10.71");
        sales["Net sales"].Amount.ShouldBe(200m);
        sales.ContainsKey("Senior/PWD discount").ShouldBeFalse();
    }

    [Fact]
    public async Task DailyClose_HeldSalesOfAnotherDay_AreNotOnThisDaysLine()
    {
        var product = SeedBasicsAndSale(200m);
        SeedHeld(product, Noon.AddDays(-1), 80m);

        var rows = await DailyClose().Handle(Day(), default);

        rows.Any(r => r.Label == GetDailyCloseReportHandler.HeldOrdersLabel).ShouldBeFalse();
    }

    [Fact]
    public async Task Dashboard_GivesAdminsTheHeldCountAndTheAgedInsight_ButNotCashiers()
    {
        var product = SeedBasicsAndSale(200m);
        SeedHeld(product, DateTime.UtcNow.AddDays(-4), 120m);
        SeedHeld(product, DateTime.UtcNow.AddHours(-3), 30m);

        var asAdmin = await new GetDashboardHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), AppRoles.Admin, "Asia/Manila"))
            .Handle(new GetDashboardQuery("last30days", null, null), default);
        var asCashier = await new GetDashboardHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), AppRoles.Cashier, "Asia/Manila"))
            .Handle(new GetDashboardQuery("last30days", null, null), default);

        var held = asAdmin.Insights!.HeldOrders!;
        held.Count.ShouldBe(2);
        held.Amount.ShouldBe(150m);
        held.AgedCount.ShouldBe(1);
        held.AgedAmount.ShouldBe(120m);
        held.AgedText.ShouldBe("1 offline order has waited more than 2 days for review (PHP 120.00)");
        asAdmin.Today.TotalOrders.ShouldBe(0);
        asCashier.Insights!.HeldOrders.ShouldBeNull();
    }

    [Fact]
    public async Task Dashboard_NothingAged_HasNoInsightText()
    {
        var product = SeedBasicsAndSale(200m);
        SeedHeld(product, DateTime.UtcNow.AddHours(-3), 30m);

        var dto = await new GetDashboardHandler(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), AppRoles.Admin, "Asia/Manila"))
            .Handle(new GetDashboardQuery("today", null, null), default);

        dto.Insights!.HeldOrders!.Count.ShouldBe(1);
        dto.Insights.HeldOrders.AgedText.ShouldBeNull();
    }

    private HeldOrderReminderService Reminders(INotificationService notifications, bool dryRun = false)
    {
        var storage = Substitute.For<IReportFileStorage>();
        return new HeldOrderReminderService(
            TestDb.Create(_dbName),
            notifications,
            storage,
            Options.Create(new HeldOrderRemindersOptions { DryRun = dryRun }));
    }

    private Guid SeedPeople()
    {
        TestDb.SeedSystemRoles(_dbName);
        using var db = TestDb.Create(_dbName);
        var admin = Guid.NewGuid();
        db.Users.AddRange(
            new User { Id = admin, Username = "admin", PasswordHash = "x", FirstName = "A", LastName = "D", IsActive = true, RoleId = (int)WTF.Api.Features.Users.Enums.UserRoleEnum.Admin },
            new User { Id = Guid.NewGuid(), Username = "cash", PasswordHash = "x", FirstName = "C", LastName = "S", IsActive = true, RoleId = (int)WTF.Api.Features.Users.Enums.UserRoleEnum.Cashier });
        db.SaveChanges();
        return admin;
    }

    [Fact]
    public async Task Reminder_TellsTheDecidersHowManyAgedOrdersWait()
    {
        var admin = SeedPeople();
        var product = SeedBasicsAndSale(10m);
        SeedHeld(product, DateTime.UtcNow.AddDays(-5), 100m);
        SeedHeld(product, DateTime.UtcNow.AddDays(-3), 50m);
        SeedHeld(product, DateTime.UtcNow.AddHours(-2), 70m);
        var notifications = Substitute.For<INotificationService>();

        var result = await Reminders(notifications).RunAsync(default);

        result.AgedOrders.ShouldBe(2);
        result.AgedAmount.ShouldBe(150m);
        await notifications.Received(1).NotifyAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Contains(admin) && ids.Count == 1),
            Arg.Is<NotificationMessage>(m => m.Kind == NotificationKinds.HeldOrderReview
                && m.Body == "2 offline orders have waited more than 2 days for review (PHP 150.00)"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Reminder_NothingAged_OrDryRun_SendsNothing()
    {
        SeedPeople();
        var product = SeedBasicsAndSale(10m);
        SeedHeld(product, DateTime.UtcNow.AddHours(-2), 70m);
        var notifications = Substitute.For<INotificationService>();

        await Reminders(notifications).RunAsync(default);
        SeedHeld(product, DateTime.UtcNow.AddDays(-9), 70m);
        await Reminders(notifications, dryRun: true).RunAsync(default);

        await notifications.DidNotReceiveWithAnyArgs().NotifyAsync(default!, default!, default);
    }
}
