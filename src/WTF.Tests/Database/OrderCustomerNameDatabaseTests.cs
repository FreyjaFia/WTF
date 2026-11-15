using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class OrderCustomerNameDatabaseTests
{
    private static async Task<Customer> CustomerAsync(SqlTestDatabase database, Guid createdBy, bool active = true)
    {
        await using var db = database.CreateContext();
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Ann",
            LastName = null,
            IsActive = active,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
        };
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        return customer;
    }

    private static CreateOrderHandler Handler(WTFDbContext db, Guid userId, IPushNotificationService? push = null) =>
        new(db, TestRequest.As(userId, AppRoles.Admin, "UTC"), TestFakes.Hub(), TestFakes.Audit(), push ?? TestFakes.Push(), TestFakes.Conversations(), TestFakes.Stock(db), TestFakes.Features);

    private static CreateOrderCommand Sale(Guid productId, Guid customerId, OrderStatusEnum status = OrderStatusEnum.Completed) => new()
    {
        Status = status,
        CustomerId = customerId,
        Items = [new OrderItemRequestDto(productId, 1, [], null, null)],
    };

    [SqlFact]
    public async Task ACustomerWithoutALastName_IsFoundByNameInPagedOrders_AndShownWithoutATrailingSpace()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        var customer = await CustomerAsync(database, user.Id);

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id).Handle(Sale(latte.Id, customer.Id), CancellationToken.None);
        }

        await using var read = database.CreateContext();
        var found = await new GetPagedOrdersHandler(read, TestFakes.Features).Handle(new GetPagedOrdersQuery(SearchTerm: "ann"), CancellationToken.None);

        found.TotalCount.ShouldBe(1);
        found.Items.Single().CustomerName.ShouldBe("Ann");

        var byId = await new GetOrderByIdHandler(read, TestFakes.Features, TestRequest.As(user.Id, AppRoles.Admin, "UTC"))
            .Handle(new GetOrderByIdQuery(found.Items.Single().Id), CancellationToken.None);
        byId!.CustomerName.ShouldBe("Ann");

        var listed = await new GetOrdersHandler(read, TestFakes.Features, TestRequest.As(user.Id, AppRoles.Admin, "UTC"))
            .Handle(new GetOrdersQuery(OrderStatusEnum.All, null), CancellationToken.None);
        listed.Single().CustomerName.ShouldBe("Ann");
    }

    [SqlFact]
    public async Task ALinkOrderFromACustomerWithoutALastName_PushesTheirName()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        var customer = await CustomerAsync(database, user.Id);
        var push = TestFakes.Push();

        await using (var db = database.CreateContext())
        {
            await Handler(db, user.Id, push).Handle(
                Sale(latte.Id, customer.Id, OrderStatusEnum.PendingApproval) with
                {
                    Source = OrderSourceEnum.CustomerLink,
                    ActorUserId = user.Id,
                },
                CancellationToken.None);
        }

        await push.Received(1).SendLinkOrderCreatedAsync(
            Arg.Any<Order>(), Arg.Any<decimal>(), "Ann", Arg.Any<FulfillmentTypeEnum?>(), Arg.Any<CancellationToken>());
    }

    [SqlFact]
    public async Task AnOfflineOrderForAnInactiveCustomerWithoutALastName_SaysTheirNameCleanly()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var user = await SqlSeed.UserAsync(database);
        var latte = await SqlSeed.ProductAsync(database, user.Id, "Latte", 100m);
        var customer = await CustomerAsync(database, user.Id, active: false);

        await using var db = database.CreateContext();
        var reasons = await OfflineOrderReview.FindReasonsAsync(
            db, Sale(latte.Id, customer.Id), TimeZoneInfo.Utc, CancellationToken.None, TestFakes.Features);

        reasons.ShouldContain("Customer Ann is inactive.");
    }
}
