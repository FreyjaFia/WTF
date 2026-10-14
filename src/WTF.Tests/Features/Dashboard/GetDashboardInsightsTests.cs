using WTF.Api.Features.Dashboard;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;
using static WTF.Tests.Features.Reports.SalesSeed;

namespace WTF.Tests.Features.Dashboard;

public class GetDashboardInsightsTests
{
    private const int PendingApproval = 5;

    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private readonly string _dbName = TestDb.NewName();

    private GetDashboardHandler Handler() =>
        new(TestDb.Create(_dbName), TestRequest.As(Guid.NewGuid(), timeZone: "Asia/Manila"));

    private static DateTime LocalToday() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Manila).Date;

    private static DateTime At(DateTime localDate, int hour) =>
        TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localDate.Date.AddHours(hour), DateTimeKind.Unspecified),
            Manila);

    private static Item NewItem(string name, decimal quantity, decimal? warning, decimal? critical, bool active = true) =>
        new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            UnitName = "pc",
            CurrentQuantity = quantity,
            WarningQuantity = warning,
            CriticalQuantity = critical,
            IsActive = active,
        };

    private static GetDashboardQuery Yesterday() => new("yesterday", null, null);

    [Fact]
    public async Task Handle_NoData_HasZeroInsights()
    {
        var dto = await Handler().Handle(Yesterday(), default);

        var insights = dto.Insights;
        insights.Discounts.ShouldBe(0m);
        insights.RefundedCount.ShouldBe(0);
        insights.RefundedAmount.ShouldBe(0m);
        insights.VoidRate.ShouldBe(0m);
        insights.LowStockCount.ShouldBe(0);
        insights.OutOfStockCount.ShouldBe(0);
        insights.AwaitingApprovalCount.ShouldBe(0);
        insights.CustomerLinkOrders.ShouldBe(0);
        insights.CustomerLinkRevenue.ShouldBe(0m);
        insights.TopPromotionName.ShouldBeNull();
        insights.TopPromotionUses.ShouldBe(0);
        insights.NewCustomers.ShouldBe(0);
        insights.ReturningCustomers.ShouldBe(0);
    }

    [Fact]
    public async Task Handle_Day_ComputesEveryInsight()
    {
        var yesterday = LocalToday().AddDays(-1);
        var newCustomer = Guid.NewGuid();
        var returningCustomer = Guid.NewGuid();
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Statuses.Add(new Status { Id = PendingApproval, Name = "PendingApproval" });
            db.Customers.Add(new Customer { Id = newCustomer, FirstName = "New", LastName = "One", IsActive = true });
            db.Customers.Add(new Customer { Id = returningCustomer, FirstName = "Old", LastName = "Timer", IsActive = true });
            var burger = Product(db, "Burger", 100m);
            var combo = Promotion(db, "Combo", 1);

            // Completed: two burgers at 80 (list 100) with a promotion label = 160, discount 40.
            var discounted = Order(db, At(yesterday, 10));
            var line = Item(db, discounted, burger, 2, 80m);
            line.OriginalPrice = 100m;
            line.PromoLabel = "20% off";

            // Completed customer link order from a first-time customer.
            var link = Sale(db, burger, At(yesterday, 11), 100m);
            link.Source = (byte)OrderSourceEnum.CustomerLink;
            link.CustomerId = newCustomer;

            // Completed order of a customer who bought before, with a bundle used three times.
            var returning = Order(db, At(yesterday, 12), customerId: returningCustomer);
            Bundle(db, returning, combo, 3, 20m);
            Order(db, At(yesterday.AddDays(-10), 12), customerId: returningCustomer);

            Sale(db, burger, At(yesterday, 13), 50m, Refunded);
            Sale(db, burger, At(yesterday, 14), 30m, Cancelled);

            // Waiting for approval, whenever it was placed.
            Sale(db, burger, At(yesterday.AddDays(-3), 9), 70m, PendingApproval);

            db.Items.AddRange(
                NewItem("Milk", 15m, 20m, 5m),
                NewItem("Lids", 4m, 20m, 5m),
                NewItem("Cups", 0m, 20m, 5m),
                NewItem("Sleeves", 100m, 20m, 5m),
                NewItem("Retired", 0m, 20m, 5m, active: false));
            await db.SaveChangesAsync();
        }

        var insights = (await Handler().Handle(Yesterday(), default)).Insights;

        insights.Discounts.ShouldBe(40m);
        insights.RefundedCount.ShouldBe(1);
        insights.RefundedAmount.ShouldBe(50m);
        // 2 of 5 finished orders were voided (3 completed, 1 refunded, 1 cancelled).
        insights.VoidRate.ShouldBe(40m, 0.0001m);
        insights.LowStockCount.ShouldBe(2);
        insights.OutOfStockCount.ShouldBe(1);
        insights.AwaitingApprovalCount.ShouldBe(1);
        insights.CustomerLinkOrders.ShouldBe(1);
        insights.CustomerLinkRevenue.ShouldBe(100m);
        insights.TopPromotionName.ShouldBe("Combo");
        insights.TopPromotionUses.ShouldBe(3);
        insights.NewCustomers.ShouldBe(1);
        insights.ReturningCustomers.ShouldBe(1);
    }

    private async Task<string?> TopPromotionAsync(params (string Label, int Quantity, decimal Price)[] lines)
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            foreach (var (label, quantity, price) in lines)
            {
                var line = Item(db, Order(db, At(yesterday, 10)), burger, quantity, price);
                line.OriginalPrice = 500m;
                line.PromoLabel = label;
            }

            await db.SaveChangesAsync();
        }

        return (await Handler().Handle(Yesterday(), default)).Insights.TopPromotionName;
    }

    [Fact]
    public async Task Handle_TopPromotion_MostUsesWins() =>
        (await TopPromotionAsync(("Few", 1, 900m), ("Many", 3, 10m))).ShouldBe("Many");

    [Fact]
    public async Task Handle_TopPromotionTie_HigherRevenueWins() =>
        (await TopPromotionAsync(("Alpha", 2, 100m), ("Zeta", 2, 200m))).ShouldBe("Zeta");

    [Fact]
    public async Task Handle_TopPromotionTieOnUsesAndRevenue_NameAToZWins() =>
        (await TopPromotionAsync(("Beta", 2, 100m), ("alpha", 2, 100m), ("Gamma", 2, 100m))).ShouldBe("alpha");

    [Fact]
    public async Task Handle_OrderAwaitingApproval_IsNotInTheTotalsButIsCountedAsAwaiting()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            db.Statuses.Add(new Status { Id = PendingApproval, Name = "PendingApproval" });
            var burger = Product(db, "Burger", 100m);
            Sale(db, burger, At(yesterday, 10), 100m);
            Sale(db, burger, At(yesterday, 11), 70m, PendingApproval);
            Sale(db, burger, At(yesterday, 12), 30m, Cancelled);
            await db.SaveChangesAsync();
        }

        var dto = await Handler().Handle(Yesterday(), default);

        dto.Today.TotalOrders.ShouldBe(2); // completed and cancelled; the waiting order is left out
        dto.Today.TotalRevenue.ShouldBe(100m);
        var status = dto.OrdersByStatus;
        (status.Pending + status.Completed + status.Cancelled + status.Refunded).ShouldBe(2);
        dto.Insights.AwaitingApprovalCount.ShouldBe(1);
        dto.RecentOrders.ShouldNotContain(o => o.StatusId == PendingApproval);
    }

    [Fact]
    public async Task Handle_OrdersOutsideTheRange_DoNotCount()
    {
        var yesterday = LocalToday().AddDays(-1);
        await using (var db = TestDb.Create(_dbName))
        {
            Basics(db);
            var burger = Product(db, "Burger", 100m);
            Sale(db, burger, At(yesterday.AddDays(-5), 10), 90m, Refunded);
            var old = Sale(db, burger, At(yesterday.AddDays(-5), 11), 90m);
            old.Source = (byte)OrderSourceEnum.CustomerLink;
            await db.SaveChangesAsync();
        }

        var insights = (await Handler().Handle(Yesterday(), default)).Insights;

        insights.RefundedCount.ShouldBe(0);
        insights.CustomerLinkOrders.ShouldBe(0);
        insights.VoidRate.ShouldBe(0m);
    }
}
