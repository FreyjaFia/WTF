using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Features.Customers;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.OrderLinks;

public class OrderLinkHandlerTests
{
    private readonly Guid _userId = Guid.NewGuid();
    private readonly string _dbName = TestDb.NewName();
    private readonly IAuditService _audit = TestFakes.Audit();

    private SetOrderingLinkAccessHandler Access() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    private CreateOrderLinkHandler Create() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit);

    private readonly IConversationNotifier _conversations = Substitute.For<IConversationNotifier>();

    private RevokeOrderLinkHandler Revoke() => new(TestDb.Create(_dbName), TestRequest.As(_userId), _audit, _conversations);

    private GetOrderLinksHandler List() => new(TestDb.Create(_dbName));

    private async Task<Customer> SeedCustomerAsync(bool allow = true, bool active = true)
    {
        var customer = CustomerSeed.NewCustomer(isActive: active);
        customer.AllowOrderingLink = allow;
        await CustomerSeed.SeedAsync(_dbName, customer);
        return customer;
    }

    private async Task<ShortLink> SeedLinkAsync(Guid customerId, DateTime? expiresAt = null, DateTime? revokedAt = null,
        string targetType = "CustomerOrder")
    {
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = targetType,
            TargetId = customerId,
            ExpiresAt = expiresAt,
            RevokedAt = revokedAt,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _userId
        };
        await TestDb.SaveAsync(_dbName, link);
        return link;
    }

    // --- enable / disable ---

    [Fact]
    public async Task SetAccess_Enable_TurnsOrderingOnAndAudits()
    {
        var customer = await SeedCustomerAsync(allow: false);

        var result = await Access().Handle(new SetOrderingLinkAccessCommand(customer.Id, true), CancellationToken.None);

        result.ShouldNotBeNull();
        result.AllowOrderingLink.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var saved = await db.Customers.SingleAsync();
        saved.AllowOrderingLink.ShouldBeTrue();
        saved.UpdatedBy.ShouldBe(_userId);
        await _audit.Received(1).LogAsync(
            AuditAction.OrderLinkEnabled, AuditEntityType.Customer, customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SetAccess_Disable_RevokesEveryActiveLinkOfThatCustomerOnly()
    {
        var customer = await SeedCustomerAsync();
        var other = await SeedCustomerAsync();
        var active = await SeedLinkAsync(customer.Id);
        var alreadyRevoked = await SeedLinkAsync(customer.Id, revokedAt: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var otherCustomers = await SeedLinkAsync(other.Id);
        var loyalty = await SeedLinkAsync(customer.Id, targetType: "Loyalty");

        var result = await Access().Handle(new SetOrderingLinkAccessCommand(customer.Id, false), CancellationToken.None);

        result!.AllowOrderingLink.ShouldBeFalse();
        result.RevokedLinks.ShouldBe(1);
        await using var db = TestDb.Create(_dbName);
        (await db.ShortLinks.SingleAsync(l => l.Id == active.Id)).RevokedAt.ShouldNotBeNull();
        (await db.ShortLinks.SingleAsync(l => l.Id == alreadyRevoked.Id)).RevokedAt
            .ShouldBe(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        (await db.ShortLinks.SingleAsync(l => l.Id == otherCustomers.Id)).RevokedAt.ShouldBeNull();
        (await db.ShortLinks.SingleAsync(l => l.Id == loyalty.Id)).RevokedAt.ShouldBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.OrderLinkDisabled, AuditEntityType.Customer, customer.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SetAccess_NoChange_DoesNotAudit()
    {
        var customer = await SeedCustomerAsync(allow: true);

        var result = await Access().Handle(new SetOrderingLinkAccessCommand(customer.Id, true), CancellationToken.None);

        result!.AllowOrderingLink.ShouldBeTrue();
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task SetAccess_EnableInactiveCustomer_Throws()
    {
        var customer = await SeedCustomerAsync(allow: false, active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Access().Handle(new SetOrderingLinkAccessCommand(customer.Id, true), CancellationToken.None));
    }

    [Fact]
    public async Task SetAccess_DisableInactiveCustomer_IsAllowed()
    {
        var customer = await SeedCustomerAsync(allow: true, active: false);

        var result = await Access().Handle(new SetOrderingLinkAccessCommand(customer.Id, false), CancellationToken.None);

        result!.AllowOrderingLink.ShouldBeFalse();
    }

    [Fact]
    public async Task SetAccess_UnknownCustomer_ReturnsNull()
    {
        var result = await Access().Handle(new SetOrderingLinkAccessCommand(Guid.NewGuid(), true), CancellationToken.None);

        result.ShouldBeNull();
    }

    // --- create ---

    [Fact]
    public async Task Create_EnabledCustomer_StoresLinkAndAuditsWithoutTheToken()
    {
        var customer = await SeedCustomerAsync();
        var end = DateTime.UtcNow.AddDays(7);

        var dto = await Create().Handle(new CreateOrderLinkCommand(customer.Id, end), CancellationToken.None);

        dto.ShouldNotBeNull();
        dto.Status.ShouldBe("Active");
        dto.Token.Length.ShouldBe(43);
        await using var db = TestDb.Create(_dbName);
        var link = await db.ShortLinks.SingleAsync();
        link.TargetType.ShouldBe("CustomerOrder");
        link.TargetId.ShouldBe(customer.Id);
        link.Token.ShouldBe(dto.Token);
        link.ExpiresAt!.Value.ShouldBe(end, TimeSpan.FromSeconds(1));
        link.CreatedBy.ShouldBe(_userId);
        link.RevokedAt.ShouldBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.OrderLinkCreated, AuditEntityType.OrderLink, link.Id.ToString(),
            Arg.Any<object?>(),
            Arg.Is<object?>(v => v != null && !v.ToString()!.Contains(dto.Token)),
            _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Create_WithoutEndDate_NeverExpires()
    {
        var customer = await SeedCustomerAsync();

        var dto = await Create().Handle(new CreateOrderLinkCommand(customer.Id, null), CancellationToken.None);

        dto!.ExpiresAt.ShouldBeNull();
        dto.Status.ShouldBe("Active");
    }

    [Fact]
    public async Task Create_TwiceForTheSameCustomer_GivesDifferentTokens()
    {
        var customer = await SeedCustomerAsync();

        var a = await Create().Handle(new CreateOrderLinkCommand(customer.Id, null), CancellationToken.None);
        var b = await Create().Handle(new CreateOrderLinkCommand(customer.Id, null), CancellationToken.None);

        a!.Token.ShouldNotBe(b!.Token);
    }

    [Fact]
    public async Task Create_EndDateInThePast_Throws()
    {
        var customer = await SeedCustomerAsync();

        await Should.ThrowAsync<ArgumentException>(() =>
            Create().Handle(new CreateOrderLinkCommand(customer.Id, DateTime.UtcNow.AddMinutes(-1)), CancellationToken.None));
        await using var db = TestDb.Create(_dbName);
        (await db.ShortLinks.CountAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task Create_OrderingNotEnabled_Throws()
    {
        var customer = await SeedCustomerAsync(allow: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(new CreateOrderLinkCommand(customer.Id, null), CancellationToken.None));
    }

    [Fact]
    public async Task Create_InactiveCustomer_Throws()
    {
        var customer = await SeedCustomerAsync(active: false);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            Create().Handle(new CreateOrderLinkCommand(customer.Id, null), CancellationToken.None));
    }

    [Fact]
    public async Task Create_UnknownCustomer_ReturnsNull()
    {
        var dto = await Create().Handle(new CreateOrderLinkCommand(Guid.NewGuid(), null), CancellationToken.None);

        dto.ShouldBeNull();
    }

    // --- list ---

    [Fact]
    public async Task List_ReturnsOnlyThisCustomersOrderingLinksWithStatusNewestFirst()
    {
        var customer = await SeedCustomerAsync();
        var other = await SeedCustomerAsync();
        await TestDb.SaveAsync(_dbName, new User
        {
            Id = _userId,
            Username = "cashier",
            PasswordHash = "x",
            FirstName = "Cara",
            LastName = "Shier",
            IsActive = true,
            RoleId = 2,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _userId
        });
        var active = await SeedLinkAsync(customer.Id);
        var expired = await SeedLinkAsync(customer.Id, expiresAt: DateTime.UtcNow.AddDays(-1));
        var revoked = await SeedLinkAsync(customer.Id, revokedAt: DateTime.UtcNow.AddMinutes(-5));
        await SeedLinkAsync(other.Id);
        await SeedLinkAsync(customer.Id, targetType: "Loyalty");

        var links = await List().Handle(new GetOrderLinksQuery(customer.Id), CancellationToken.None);

        links.ShouldNotBeNull();
        links.Count.ShouldBe(3);
        links.Single(l => l.Id == active.Id).Status.ShouldBe("Active");
        links.Single(l => l.Id == expired.Id).Status.ShouldBe("Expired");
        links.Single(l => l.Id == revoked.Id).Status.ShouldBe("Revoked");
        links.ShouldAllBe(l => l.CreatedByName == "Cara Shier");
        links.Select(l => l.CreatedAt).ShouldBe(links.Select(l => l.CreatedAt).OrderByDescending(x => x));
    }

    [Fact]
    public async Task List_CountsTheOrdersEachLinkProduced_WhateverBecameOfThem()
    {
        var customer = await SeedCustomerAsync();
        await TestDb.SaveAsync(_dbName, new User
        {
            Id = _userId,
            Username = "cashier",
            PasswordHash = "x",
            FirstName = "Cara",
            LastName = "Shier",
            IsActive = true,
            RoleId = 2,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _userId
        });
        var busy = await SeedLinkAsync(customer.Id);
        var quiet = await SeedLinkAsync(customer.Id);
        var revoked = await SeedLinkAsync(customer.Id, revokedAt: DateTime.UtcNow.AddMinutes(-5));
        await using (var db = TestDb.Create(_dbName))
        {
            db.Statuses.AddRange(
                new Status { Id = 1, Name = "Pending" }, new Status { Id = 3, Name = "Cancelled" },
                new Status { Id = 5, Name = "PendingApproval" });
            foreach (var (link, status) in new[] { (busy, 5), (busy, 1), (busy, 3), (revoked, 1) })
            {
                db.Orders.Add(new Order
                {
                    Id = Guid.NewGuid(),
                    OrderNumber = Random.Shared.Next(1, 1_000_000),
                    CustomerId = customer.Id,
                    OrderLinkId = link.Id,
                    StatusId = status,
                    CreatedAt = DateTime.UtcNow,
                    CreatedBy = _userId,
                    Source = 1
                });
            }

            // An order from the shop is not the link's.
            db.Orders.Add(new Order
            {
                Id = Guid.NewGuid(),
                OrderNumber = Random.Shared.Next(1, 1_000_000),
                CustomerId = customer.Id,
                StatusId = 1,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = _userId
            });
            await db.SaveChangesAsync();
        }

        var links = await List().Handle(new GetOrderLinksQuery(customer.Id), CancellationToken.None);

        links!.Single(l => l.Id == busy.Id).OrdersCount.ShouldBe(3);
        links.Single(l => l.Id == quiet.Id).OrdersCount.ShouldBe(0);
        links.Single(l => l.Id == revoked.Id).OrdersCount.ShouldBe(1);
    }

    [Fact]
    public async Task Revoke_SendsEveryPageOpenThroughTheLinkBackToTheInvalidLinkPage()
    {
        var customer = await SeedCustomerAsync();
        var link = await SeedLinkAsync(customer.Id);

        await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None);

        await _conversations.Received(1).LinkRevokedAsync(link.Id, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Revoke_AnAlreadyRevokedLinkOrAnUnknownOne_SaysNothing()
    {
        var customer = await SeedCustomerAsync();
        var link = await SeedLinkAsync(customer.Id, revokedAt: DateTime.UtcNow.AddMinutes(-5));

        await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None);
        await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, Guid.NewGuid()), CancellationToken.None);

        await _conversations.DidNotReceiveWithAnyArgs().LinkRevokedAsync(default, default);
    }

    [Fact]
    public async Task List_UnknownCustomer_ReturnsNull()
    {
        (await List().Handle(new GetOrderLinksQuery(Guid.NewGuid()), CancellationToken.None)).ShouldBeNull();
    }

    // --- revoke ---

    [Fact]
    public async Task Revoke_ActiveLink_SetsRevokedAtAndAudits()
    {
        var customer = await SeedCustomerAsync();
        var link = await SeedLinkAsync(customer.Id);

        var result = await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ShortLinks.SingleAsync()).RevokedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.OrderLinkRevoked, AuditEntityType.OrderLink, link.Id.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), _userId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Revoke_AlreadyRevoked_KeepsFirstTimeAndDoesNotAuditAgain()
    {
        var customer = await SeedCustomerAsync();
        var first = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var link = await SeedLinkAsync(customer.Id, revokedAt: first);

        var result = await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ShortLinks.SingleAsync()).RevokedAt.ShouldBe(first);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!);
    }

    [Fact]
    public async Task Revoke_LinkOfAnotherCustomer_ReturnsFalseAndLeavesItActive()
    {
        var customer = await SeedCustomerAsync();
        var other = await SeedCustomerAsync();
        var link = await SeedLinkAsync(other.Id);

        var result = await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None);

        result.ShouldBeFalse();
        await using var db = TestDb.Create(_dbName);
        (await db.ShortLinks.SingleAsync()).RevokedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Revoke_LoyaltyLink_ReturnsFalse()
    {
        var customer = await SeedCustomerAsync();
        var link = await SeedLinkAsync(customer.Id, targetType: "Loyalty");

        (await Revoke().Handle(new RevokeOrderLinkCommand(customer.Id, link.Id), CancellationToken.None)).ShouldBeFalse();
    }
}
