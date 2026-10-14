using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>
/// Customer ordering links against a real SQL Server: what the in-memory provider cannot show (case-insensitive text
/// compare, the unique token index, foreign keys, the subquery of the link re-check, and the new status row).
/// </summary>
public class OrderLinkDatabaseTests
{
    private sealed record Setup(SqlTestDatabase Database, User Staff, User SystemUser, Customer Customer, ShortLink Link, Product Latte);

    private static async Task<Setup> SeedAsync(SqlTestDatabase database)
    {
        var staff = await SqlSeed.UserAsync(database, "cashier", roleId: 2);
        var system = await SqlSeed.UserAsync(database, SubmitPublicOrderHandler.SystemUsername, roleId: 2, active: false);
        var latte = await SqlSeed.ProductAsync(database, staff.Id, "Latte", 150m);

        await using var db = database.CreateContext();
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = staff.Id
        };
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = staff.Id
        };
        db.Customers.Add(customer);
        db.ShortLinks.Add(link);
        await db.SaveChangesAsync();

        return new Setup(database, staff, system, customer, link, latte);
    }

    private static ISender Sender(SqlTestDatabase database)
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<IRequest<OrderDto>>(), Arg.Any<CancellationToken>())
            .Returns(async call =>
            {
                await using var db = database.CreateContext();
                return await new CreateOrderHandler(db, TestRequest.None(), TestFakes.Hub(), TestFakes.Audit(), TestFakes.Push(), TestFakes.Conversations())
                    .Handle((CreateOrderCommand)call.Arg<IRequest<OrderDto>>(), call.Arg<CancellationToken>());
            });
        return sender;
    }

    private static SubmitPublicOrderRequest Request(Product product, decimal amount = 500) =>
        new([new PublicOrderItemRequest(product.Id, 2, null, "less ice")], FulfillmentTypeEnum.Delivery,
            "5 Side St", "0917 123 4567", PaymentMethodEnum.Cash, amount, "No ice");

    [SqlFact]
    public async Task StatusRow5_PendingApproval_ExistsInTheSchemaTheTestsBuild()
    {
        await using var database = await SqlTestDatabase.CreateAsync();

        await using var db = database.CreateContext();
        (await db.Statuses.SingleAsync(s => s.Id == (int)OrderStatusEnum.PendingApproval)).Name.ShouldBe("PendingApproval");
    }

    // --- the token ---

    [SqlFact]
    public async Task Token_AFullLengthTokenIsStored_AndATokenIsUnique()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);

        await using (var db = database.CreateContext())
        {
            var stored = await db.ShortLinks.SingleAsync();
            stored.Token.Length.ShouldBe(43);
            stored.Token.ShouldBe(setup.Link.Token);
        }

        await using var duplicate = database.CreateContext();
        duplicate.ShortLinks.Add(new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = setup.Link.Token,
            TargetType = OrderLinkToken.TargetType,
            TargetId = setup.Customer.Id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = setup.Staff.Id
        });
        await Should.ThrowAsync<DbUpdateException>(() => duplicate.SaveChangesAsync());
    }

    [SqlFact]
    public async Task Resolve_ATokenInTheWrongCase_IsRejectedEvenThoughSqlServerMatchesIt()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        // Make sure the case change really changes the token.
        await using (var seed = database.CreateContext())
        {
            (await seed.ShortLinks.SingleAsync()).Token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe";
            await seed.SaveChangesAsync();
        }

        await using var db = database.CreateContext();
        (await OrderLinkAccess.ResolveAsync(db, "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe", default)).ShouldNotBeNull();

        await using var other = database.CreateContext();
        (await other.ShortLinks.AnyAsync(l => l.Token == "abcdefghijklmnopqrstuvwxyz0123456789_-abcde"))
            .ShouldBeTrue("SQL Server compares this column without regard to case");
        (await OrderLinkAccess.ResolveAsync(other, "abcdefghijklmnopqrstuvwxyz0123456789_-abcde", default)).ShouldBeNull();
        _ = setup;
    }

    // --- the re-check ---

    [SqlFact]
    public async Task StillValid_TranslatesToSqlAndFollowsTheLinkAndTheCustomer()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        var now = DateTime.UtcNow;

        async Task<bool> Check()
        {
            await using var db = database.CreateContext();
            return await OrderLinkAccess.IsStillValidAsync(db, setup.Link.Id, now, default);
        }

        (await Check()).ShouldBeTrue();

        await using (var db = database.CreateContext())
        {
            (await db.Customers.SingleAsync()).AllowOrderingLink = false;
            await db.SaveChangesAsync();
        }

        (await Check()).ShouldBeFalse("ordering switched off");

        await using (var db = database.CreateContext())
        {
            (await db.Customers.SingleAsync()).AllowOrderingLink = true;
            (await db.ShortLinks.SingleAsync()).ExpiresAt = now;
            await db.SaveChangesAsync();
        }

        (await Check()).ShouldBeFalse("a link ends at its end date");

        await using (var db = database.CreateContext())
        {
            var link = await db.ShortLinks.SingleAsync();
            link.ExpiresAt = now.AddMinutes(5);
            link.RevokedAt = now;
            await db.SaveChangesAsync();
        }

        (await Check()).ShouldBeFalse("revoked");
    }

    // --- placing and answering an order, with every constraint enforced ---

    [SqlFact]
    public async Task Submit_CreatesAWaitingOrderWithItsLinkAndSystemUser_AndItShowsUnderMyOrders()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);

        PublicOrderDto? placed;
        await using (var db = database.CreateContext())
        {
            placed = await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default);
        }

        placed.ShouldNotBeNull();
        placed.StatusKind.ShouldBe("waiting");
        placed.Total.ShouldBe(300);

        await using (var check = database.CreateContext())
        {
            var order = await check.Orders.SingleAsync();
            order.StatusId.ShouldBe((int)OrderStatusEnum.PendingApproval);
            order.Source.ShouldBe((byte)OrderSourceEnum.CustomerLink);
            order.OrderLinkId.ShouldBe(setup.Link.Id);
            order.CreatedBy.ShouldBe(setup.SystemUser.Id);
            order.CustomerId.ShouldBe(setup.Customer.Id);
            order.DeliveryAddress.ShouldBe("5 Side St");
            order.ContactNumber.ShouldBe("0917 123 4567");
            order.AmountReceived.ShouldBe(500);
            order.ChangeAmount.ShouldBe(200);
        }

        await using var read = database.CreateContext();
        var mine = await new GetPublicOrdersHandler(read)
            .Handle(new GetPublicOrdersQuery(setup.Link.Token), default);
        mine!.Items.ShouldHaveSingleItem().Id.ShouldBe(placed.Id);
    }

    [SqlFact]
    public async Task Submit_AddressAndContactAtTheirLimits_FitTheColumns()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        var request = Request(setup.Latte) with
        {
            DeliveryAddress = new string('a', SubmitPublicOrderHandler.MaxAddressLength),
            ContactNumber = new string('1', SubmitPublicOrderHandler.MaxContactLength)
        };

        await using var db = database.CreateContext();
        var placed = await new SubmitPublicOrderHandler(
                db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
            .Handle(new SubmitPublicOrderCommand(setup.Link.Token, request), default);

        placed.ShouldNotBeNull();
        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.DeliveryAddress!.Length.ShouldBe(SubmitPublicOrderHandler.MaxAddressLength);
        order.ContactNumber!.Length.ShouldBe(SubmitPublicOrderHandler.MaxContactLength);
    }

    [SqlFact]
    public async Task Submit_ATipIsStoredInTheTipsColumn()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);

        await using (var db = database.CreateContext())
        {
            var placed = await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte, 500) with { Tips = 12.345m }), default);
            placed!.Tips.ShouldBe(12.35m);
        }

        await using var check = database.CreateContext();
        var order = await check.Orders.SingleAsync();
        order.Tips.ShouldBe(12.35m);
        order.ChangeAmount.ShouldBe(500 - 300 - 12.35m);
    }

    [SqlFact]
    public async Task Submit_ALinkRevokedBeforeTheRequest_CreatesNothing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        await using (var db = database.CreateContext())
        {
            (await db.ShortLinks.SingleAsync()).RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        await using var handlerDb = database.CreateContext();
        var result = await new SubmitPublicOrderHandler(
                handlerDb, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
            .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default);

        result.ShouldBeNull();
        await using var check = database.CreateContext();
        (await check.Orders.CountAsync()).ShouldBe(0);
    }

    [SqlFact]
    public async Task Submit_StopsAtTheWaitingLimit_CountingOnlyThisCustomersWaitingLinkOrders()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);

        for (var i = 0; i < SubmitPublicOrderHandler.MaxWaitingOrders; i++)
        {
            await using var db = database.CreateContext();
            (await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default)).ShouldNotBeNull();
        }

        await using var last = database.CreateContext();
        await Should.ThrowAsync<InvalidOperationException>(() => new SubmitPublicOrderHandler(
                last, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
            .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default));
    }

    [SqlFact]
    public async Task WaitingOrders_AreKeptOutOfTheNormalListsAndFoundByStatus()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        await using (var db = database.CreateContext())
        {
            await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default);
        }

        await using var read = database.CreateContext();
        var all = await new GetPagedOrdersHandler(read).Handle(new GetPagedOrdersQuery(), default);
        var active = await new GetPagedOrdersHandler(read).Handle(new GetPagedOrdersQuery(ExcludeFinalized: true), default);
        var waiting = await new GetPagedOrdersHandler(read)
            .Handle(new GetPagedOrdersQuery(Status: OrderStatusEnum.PendingApproval), default);

        all.TotalCount.ShouldBe(0);
        active.TotalCount.ShouldBe(0);
        waiting.Items.ShouldHaveSingleItem().ContactNumber.ShouldBe("0917 123 4567");
        waiting.Items[0].FulfillmentType.ShouldBe(FulfillmentTypeEnum.Delivery);
    }

    [SqlFact]
    public async Task ApproveAndReject_MoveTheOrderBetweenStatusesAndKeepTheReason()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        var ids = new List<Guid>();
        for (var i = 0; i < 2; i++)
        {
            await using var db = database.CreateContext();
            var placed = await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default);
            ids.Add(placed!.Id);
        }

        ISender GetById()
        {
            var sender = Substitute.For<ISender>();
            sender.Send(Arg.Any<IRequest<OrderDto?>>(), Arg.Any<CancellationToken>())
                .Returns(async call =>
                {
                    await using var readDb = database.CreateContext();
                    return await new GetOrderByIdHandler(readDb)
                        .Handle((GetOrderByIdQuery)call.Arg<IRequest<OrderDto?>>(), call.Arg<CancellationToken>());
                });
            return sender;
        }

        await using (var db = database.CreateContext())
        {
            await new ApproveOrderHandler(db, TestRequest.As(setup.Staff.Id, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), Substitute.For<WTF.Api.Services.IConversationNotifier>(), GetById())
                .Handle(new ApproveOrderCommand(ids[0]), default);
        }

        await using (var db = database.CreateContext())
        {
            await new RejectOrderHandler(db, TestRequest.As(setup.Staff.Id, AppRoles.Cashier), TestFakes.Hub(), TestFakes.Audit(), Substitute.For<WTF.Api.Services.IConversationNotifier>(), GetById())
                .Handle(new RejectOrderCommand(ids[1], "Out of stock"), default);
        }

        await using var check = database.CreateContext();
        var approved = await check.Orders.SingleAsync(o => o.Id == ids[0]);
        var rejected = await check.Orders.SingleAsync(o => o.Id == ids[1]);
        approved.StatusId.ShouldBe((int)OrderStatusEnum.Pending);
        approved.UpdatedBy.ShouldBe(setup.Staff.Id);
        rejected.StatusId.ShouldBe((int)OrderStatusEnum.Cancelled);
        rejected.RejectionReason.ShouldBe("Out of stock");
    }

    [SqlFact]
    public async Task ARejectedReasonOfFiveHundredCharactersFitsTheColumn()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        var setup = await SeedAsync(database);
        Guid orderId;
        await using (var db = database.CreateContext())
        {
            orderId = (await new SubmitPublicOrderHandler(
                    db, Sender(database), NullLogger<SubmitPublicOrderHandler>.Instance, TimeProvider.System)
                .Handle(new SubmitPublicOrderCommand(setup.Link.Token, Request(setup.Latte)), default))!.Id;
        }

        await using (var db = database.CreateContext())
        {
            var order = await db.Orders.SingleAsync(o => o.Id == orderId);
            order.StatusId = (int)OrderStatusEnum.Cancelled;
            order.RejectionReason = new string('r', 500);
            await db.SaveChangesAsync();
        }

        await using var check = database.CreateContext();
        (await check.Orders.SingleAsync()).RejectionReason!.Length.ShouldBe(500);
    }
}
