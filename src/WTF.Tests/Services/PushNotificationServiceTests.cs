using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Services;

public class PushNotificationServiceTests
{
    private readonly string _dbName = TestDb.NewName();
    private readonly IFcmPushClient _fcm = Substitute.For<IFcmPushClient>();
    private readonly IHuaweiPushClient _huawei = Substitute.For<IHuaweiPushClient>();
    private readonly Guid _actor = Guid.NewGuid();
    private readonly Order _order = new() { Id = Guid.NewGuid(), OrderNumber = 42 };

    public PushNotificationServiceTests()
    {
        _fcm.IsConfigured.Returns(true);
        _huawei.IsConfigured.Returns(true);
        _fcm.SendAsync(default!, default!, default!, default, default).ReturnsForAnyArgs(true);
        _huawei.SendAsync(default!, default!, default!, default, default).ReturnsForAnyArgs(true);

        using var db = TestDb.Create(_dbName);
        db.UserRoles.AddRange(
            new UserRole { Id = 1, Name = AppRoles.Admin },
            new UserRole { Id = 2, Name = AppRoles.AdminViewer },
            new UserRole { Id = 3, Name = AppRoles.SuperAdmin });
        db.SaveChanges();
    }

    private PushNotificationService Service() =>
        new(TestDb.Create(_dbName), _fcm, _huawei, NullLogger<PushNotificationService>.Instance);

    private Guid AddUser(int roleId = 1, bool active = true, Guid? id = null)
    {
        using var db = TestDb.Create(_dbName);
        var user = new User
        {
            Id = id ?? Guid.NewGuid(),
            Username = $"u-{Guid.NewGuid():N}",
            PasswordHash = "x",
            FirstName = "A",
            LastName = "B",
            IsActive = active,
            RoleId = roleId
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private void AddToken(Guid userId, string token, string platform = "android", bool active = true)
    {
        using var db = TestDb.Create(_dbName);
        db.PushNotificationTokens.Add(new PushNotificationToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Token = token,
            Platform = platform,
            IsActive = active
        });
        db.SaveChanges();
    }

    private Task SendCreated() => Service().SendOrderCreatedAsync(_order, 1234.5m, _actor, CancellationToken.None);

    private Task SendStatus(OrderStatusEnum status) =>
        Service().SendOrderStatusChangedAsync(_order, 99m, status, _actor, CancellationToken.None);

    private static IEnumerable<NSubstitute.Core.ICall> Sends(object client) =>
        client.ReceivedCalls().Where(c => c.GetMethodInfo().Name == "SendAsync");

    private static IReadOnlyDictionary<string, string>? AnyData() => Arg.Any<IReadOnlyDictionary<string, string>?>();

    // ---- configuration / no tokens -----------------------------------------------------------

    [Fact]
    public async Task SendOrderCreatedAsync_NoClientConfigured_SendsNothing()
    {
        _fcm.IsConfigured.Returns(false);
        _huawei.IsConfigured.Returns(false);
        AddToken(AddUser(), "t1");

        await SendCreated();

        await _fcm.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
        await _huawei.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_NoTokens_SendsNothing()
    {
        await SendCreated();

        await _fcm.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
        await _huawei.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_OnlyFcmConfigured_StillSendsFcmTokens()
    {
        _huawei.IsConfigured.Returns(false);
        AddToken(AddUser(), "t1");

        await SendCreated();

        await _fcm.Received(1).SendAsync("t1", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
    }

    // ---- token selection ---------------------------------------------------------------------

    [Fact]
    public async Task SendOrderCreatedAsync_TokensPerPlatform_HuaweiGoesToHuaweiOthersToFcm()
    {
        var user = AddUser();
        AddToken(user, "android-1", "android");
        AddToken(user, "web-1", "web");
        AddToken(user, "ios-1", "ios");
        AddToken(user, "hw-1", "huawei");
        AddToken(user, "hw-2", "HUAWEI");

        await SendCreated();

        var fcmTokens = Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).ToList();
        fcmTokens.OrderBy(t => t).ShouldBe(["android-1", "ios-1", "web-1"]);
        var huaweiTokens = Sends(_huawei).Select(c => (string)c.GetArguments()[0]!).ToList();
        huaweiTokens.OrderBy(t => t).ShouldBe(["hw-1", "hw-2"]);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_InactiveToken_IsSkipped()
    {
        var user = AddUser();
        AddToken(user, "live");
        AddToken(user, "dead", active: false);

        await SendCreated();

        await _fcm.Received(1).SendAsync("live", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
        await _fcm.DidNotReceive().SendAsync("dead", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendOrderCreatedAsync_InactiveUser_TokenIsSkipped()
    {
        AddToken(AddUser(active: false), "inactive-user");
        AddToken(AddUser(), "active-user");

        await SendCreated();

        var sent = Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).ToList();
        sent.ShouldBe(["active-user"]);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_AdminViewerRole_IsSkipped()
    {
        AddToken(AddUser(roleId: 2), "viewer");
        AddToken(AddUser(roleId: 1), "admin");
        AddToken(AddUser(roleId: 3), "super");

        await SendCreated();

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).OrderBy(t => t).ShouldBe(["admin", "super"]);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_ActingUser_IsNotNotifiedAboutOwnAction()
    {
        AddToken(AddUser(id: _actor), "mine");
        AddToken(AddUser(), "theirs");

        await SendCreated();

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).ShouldBe(["theirs"]);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_OnlyTheActorHasTokens_SendsNothing()
    {
        AddToken(AddUser(id: _actor), "mine");

        await SendCreated();

        await _fcm.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_SameTokenRegisteredByTwoUsers_IsSentOnce()
    {
        AddToken(AddUser(), "shared");
        AddToken(AddUser(), "shared");

        await SendCreated();

        await _fcm.Received(1).SendAsync("shared", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
    }

    // ---- payload -----------------------------------------------------------------------------

    [Fact]
    public async Task SendOrderCreatedAsync_Payload_HasTitleBodyAndDeepLink()
    {
        AddToken(AddUser(), "t1");
        AddToken(AddUser(), "hw", "huawei");

        await SendCreated();

        foreach (var call in Sends(_fcm).Concat(Sends(_huawei)))
        {
            var args = call.GetArguments();
            args[1].ShouldBe("New order created");
            args[2].ShouldBe("Order #42 • PHP 1,234.50");
            var data = (IReadOnlyDictionary<string, string>)args[3]!;
            data["orderId"].ShouldBe(_order.Id.ToString());
            data["orderNumber"].ShouldBe("42");
            data["path"].ShouldBe($"/orders/editor/{_order.Id}");
            data.ContainsKey("status").ShouldBeFalse();
        }

        Sends(_fcm).Count().ShouldBe(1);
        Sends(_huawei).Count().ShouldBe(1);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed, "Order completed")]
    [InlineData(OrderStatusEnum.Cancelled, "Order cancelled")]
    [InlineData(OrderStatusEnum.Refunded, "Order refunded")]
    [InlineData(OrderStatusEnum.Pending, "Order updated")]
    [InlineData(OrderStatusEnum.All, "Order updated")]
    public async Task SendOrderStatusChangedAsync_Status_SetsTitleAndPayload(OrderStatusEnum status, string expectedTitle)
    {
        AddToken(AddUser(), "t1");

        await SendStatus(status);

        var args = Sends(_fcm).ShouldHaveSingleItem().GetArguments();
        args[0].ShouldBe("t1");
        args[1].ShouldBe(expectedTitle);
        args[2].ShouldBe("Order #42 • PHP 99.00");
        var data = (IReadOnlyDictionary<string, string>)args[3]!;
        data["status"].ShouldBe(status.ToString());
        data["orderNumber"].ShouldBe("42");
        data["path"].ShouldBe($"/orders/details/{_order.Id}");
    }

    [Fact]
    public async Task SendOrderStatusChangedAsync_TokenSelection_FollowsSameRulesAsCreated()
    {
        var user = AddUser();
        AddToken(user, "fcm-live");
        AddToken(user, "fcm-dead", active: false);
        AddToken(user, "hw-live", "huawei");
        AddToken(AddUser(roleId: 2), "viewer");
        AddToken(AddUser(active: false), "inactive-user");
        AddToken(AddUser(id: _actor), "actor");

        await SendStatus(OrderStatusEnum.Completed);

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).ShouldBe(["fcm-live"]);
        Sends(_huawei).Select(c => (string)c.GetArguments()[0]!).ShouldBe(["hw-live"]);
    }

    [Fact]
    public async Task SendOrderStatusChangedAsync_NoClientConfigured_SendsNothing()
    {
        _fcm.IsConfigured.Returns(false);
        _huawei.IsConfigured.Returns(false);
        AddToken(AddUser(), "t1");

        await SendStatus(OrderStatusEnum.Completed);

        await _fcm.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
    }

    [Fact]
    public async Task SendOrderStatusChangedAsync_NoTokens_SendsNothing()
    {
        await SendStatus(OrderStatusEnum.Cancelled);

        await _fcm.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
        await _huawei.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default, default);
    }

    // ---- failure isolation -------------------------------------------------------------------

    [Fact]
    public async Task SendOrderCreatedAsync_OneFcmTokenThrows_OtherTokensStillSent()
    {
        var user = AddUser();
        AddToken(user, "bad");
        AddToken(user, "good");
        AddToken(user, "hw", "huawei");
        _fcm.SendAsync("bad", default!, default!, default, default).ReturnsForAnyArgs(ci =>
            ci.ArgAt<string>(0) == "bad" ? throw new HttpRequestException("fcm down") : Task.FromResult(true));

        await Should.NotThrowAsync(SendCreated);

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).OrderBy(t => t).ShouldBe(["bad", "good"]);
        Sends(_huawei).Count().ShouldBe(1);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_FcmClientThrows_HuaweiTokensStillSent()
    {
        var user = AddUser();
        AddToken(user, "fcm");
        AddToken(user, "hw", "huawei");
        _fcm.SendAsync(default!, default!, default!, default, default)
            .ReturnsForAnyArgs(_ => Task.FromException<bool>(new HttpRequestException("fcm down")));

        await Should.NotThrowAsync(SendCreated);

        await _huawei.Received(1).SendAsync("hw", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendOrderStatusChangedAsync_HuaweiClientThrows_DoesNotPropagate()
    {
        AddToken(AddUser(), "fcm");
        AddToken(AddUser(), "hw", "huawei");
        _huawei.SendAsync(default!, default!, default!, default, default)
            .ReturnsForAnyArgs(_ => Task.FromException<bool>(new HttpRequestException("huawei down")));

        await Should.NotThrowAsync(() => SendStatus(OrderStatusEnum.Completed));

        await _fcm.Received(1).SendAsync("fcm", Arg.Any<string>(), Arg.Any<string>(), AnyData(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendOrderCreatedAsync_ClientReturnsFalse_DoesNotThrowAndKeepsSending()
    {
        var user = AddUser();
        AddToken(user, "a");
        AddToken(user, "b");
        _fcm.SendAsync(default!, default!, default!, default, default).ReturnsForAnyArgs(false);

        await Should.NotThrowAsync(SendCreated);

        Sends(_fcm).Count().ShouldBe(2);
    }

    // ---- cancellation ------------------------------------------------------------------------

    [Fact]
    public async Task SendOrderCreatedAsync_CancellationRequested_ReachesTheClients()
    {
        AddToken(AddUser(), "t1");
        using var cts = new CancellationTokenSource();

        await Service().SendOrderCreatedAsync(_order, 10m, _actor, cts.Token);

        await _fcm.Received(1).SendAsync("t1", Arg.Any<string>(), Arg.Any<string>(), AnyData(), cts.Token);
    }

    // ---- online (customer link) orders -----------------------------------------------------------

    private Task SendOnline(string? customer = "Maria Cruz", FulfillmentTypeEnum? fulfillment = FulfillmentTypeEnum.Delivery) =>
        Service().SendLinkOrderCreatedAsync(_order, 360m, customer, fulfillment, CancellationToken.None);

    [Fact]
    public async Task SendLinkOrderCreatedAsync_TellsStaffAboutTheOnlineOrderAndOpensTheOrdersList()
    {
        AddToken(AddUser(), "t1");

        await SendOnline();

        var call = Sends(_fcm).Single().GetArguments();
        call[0].ShouldBe("t1");
        call[1].ShouldBe("New online order");
        call[2].ShouldBe("Order #42 - Maria Cruz - Delivery - PHP 360.00");
        var data = (IReadOnlyDictionary<string, string>)call[3]!;
        data["orderId"].ShouldBe(_order.Id.ToString());
        data["orderNumber"].ShouldBe("42");
        data["type"].ShouldBe("online-order");
        data["type"].ShouldBe(PushTypes.OnlineOrder);
        data["path"].ShouldBe("/orders/list");
    }

    // ---- chat messages ---------------------------------------------------------------------------

    private Task SendMessage(OrderStatusEnum status = OrderStatusEnum.Pending, string? customer = "Maria Cruz",
        string preview = "Is 5pm ok?")
    {
        _order.StatusId = (int)status;
        return Service().SendOrderMessageAsync(_order, customer, preview, CancellationToken.None);
    }

    [Fact]
    public async Task SendOrderMessageAsync_TellsStaffWhoWroteWhatAndOnWhichOrder()
    {
        AddToken(AddUser(), "t1");

        await SendMessage();

        var call = Sends(_fcm).Single().GetArguments();
        call[0].ShouldBe("t1");
        call[1].ShouldBe("New message on order #42");
        call[2].ShouldBe("Maria Cruz: Is 5pm ok?");
        var data = (IReadOnlyDictionary<string, string>)call[3]!;
        data["type"].ShouldBe(PushTypes.OrderMessage);
        data["type"].ShouldBe("order-message");
        data["orderId"].ShouldBe(_order.Id.ToString());
        data["orderNumber"].ShouldBe("42");
        data["chat"].ShouldBe("open");
    }

    [Theory]
    [InlineData(OrderStatusEnum.PendingApproval, "details")]
    [InlineData(OrderStatusEnum.Pending, "editor")]
    public async Task SendOrderMessageAsync_OpensTheScreenThatCanShowThatOrder(OrderStatusEnum status, string screen)
    {
        AddToken(AddUser(), "t1");

        await SendMessage(status);

        var data = (IReadOnlyDictionary<string, string>)Sends(_fcm).Single().GetArguments()[3]!;
        data["path"].ShouldBe($"/orders/{screen}/{_order.Id}");
    }

    [Fact]
    public async Task SendOrderMessageAsync_AnUnnamedCustomerIsJustCustomer()
    {
        AddToken(AddUser(), "t1");

        await SendMessage(customer: "  ");

        Sends(_fcm).Single().GetArguments()[2].ShouldBe("Customer: Is 5pm ok?");
    }

    [Fact]
    public async Task SendOrderMessageAsync_GoesToActiveStaffExceptViewers()
    {
        AddToken(AddUser(), "cashier-token");
        AddToken(AddUser(3), "admin-token");
        AddToken(AddUser(2), "viewer-token");
        AddToken(AddUser(active: false), "inactive-token");

        await SendMessage();

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).OrderBy(x => x)
            .ShouldBe(["admin-token", "cashier-token"]);
    }

    [Fact]
    public async Task SendLinkOrderCreatedAsync_DoesNotOpenTheEditor_WhichCannotShowAWaitingOrder()
    {
        AddToken(AddUser(), "t1");

        await SendOnline();

        var data = (IReadOnlyDictionary<string, string>)Sends(_fcm).Single().GetArguments()[3]!;
        data["path"].ShouldNotContain("/orders/editor");
    }

    [Theory]
    [InlineData("Maria Cruz", FulfillmentTypeEnum.Pickup, "Order #42 - Maria Cruz - Pickup - PHP 360.00")]
    [InlineData("  Maria  ", FulfillmentTypeEnum.Delivery, "Order #42 - Maria - Delivery - PHP 360.00")]
    [InlineData(null, FulfillmentTypeEnum.Pickup, "Order #42 - Pickup - PHP 360.00")]
    [InlineData("", FulfillmentTypeEnum.Delivery, "Order #42 - Delivery - PHP 360.00")]
    [InlineData("Maria Cruz", null, "Order #42 - Maria Cruz - PHP 360.00")]
    public async Task SendLinkOrderCreatedAsync_BodyLeavesOutWhatIsMissing(
        string? customer, FulfillmentTypeEnum? fulfillment, string expectedBody)
    {
        AddToken(AddUser(), "t1");

        await SendOnline(customer, fulfillment);

        Sends(_fcm).Single().GetArguments()[2].ShouldBe(expectedBody);
    }

    [Fact]
    public async Task SendLinkOrderCreatedAsync_GoesToEveryActiveStaffMemberExceptViewers_NobodyIsExcludedAsTheActor()
    {
        var cashier = AddUser();
        var admin = AddUser(3);
        var viewer = AddUser(2);
        var inactiveUser = AddUser(active: false);
        AddToken(cashier, "cashier-token");
        AddToken(admin, "admin-token");
        AddToken(viewer, "viewer-token");
        AddToken(inactiveUser, "inactive-user-token");
        AddToken(cashier, "inactive-token", active: false);
        // The order is owned by the inactive system user, so even a user who happens to match must still be told.
        AddToken(AddUser(id: _actor), "actor-token");

        await SendOnline();

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).OrderBy(x => x)
            .ShouldBe(["actor-token", "admin-token", "cashier-token"]);
    }

    [Fact]
    public async Task SendLinkOrderCreatedAsync_SplitsFcmAndHuaweiTokens()
    {
        var user = AddUser();
        AddToken(user, "android-1", "android");
        AddToken(user, "hw-1", "huawei");

        await SendOnline();

        Sends(_fcm).Select(c => (string)c.GetArguments()[0]!).ShouldBe(["android-1"]);
        Sends(_huawei).Select(c => (string)c.GetArguments()[0]!).ShouldBe(["hw-1"]);
    }

    [Fact]
    public async Task SendLinkOrderCreatedAsync_NothingConfiguredOrNoTokens_SendsNothing()
    {
        await SendOnline();
        Sends(_fcm).ShouldBeEmpty();

        _fcm.IsConfigured.Returns(false);
        _huawei.IsConfigured.Returns(false);
        AddToken(AddUser(), "t1");
        await SendOnline();

        Sends(_fcm).ShouldBeEmpty();
        Sends(_huawei).ShouldBeEmpty();
    }

    [Fact]
    public async Task SendLinkOrderCreatedAsync_OneClientFailing_DoesNotStopTheOthersOrFailTheOrder()
    {
        var user = AddUser();
        AddToken(user, "android-1", "android");
        AddToken(user, "hw-1", "huawei");
        _fcm.SendAsync(default!, default!, default!, default, default).ThrowsAsyncForAnyArgs(new InvalidOperationException("boom"));

        await Should.NotThrowAsync(() => SendOnline());

        Sends(_huawei).Count().ShouldBe(1);
    }

    [Fact]
    public async Task SendOrderCreatedAsync_ForPosOrders_IsUnchangedAndCarriesNoType()
    {
        AddToken(AddUser(), "t1");

        await SendCreated();

        var data = (IReadOnlyDictionary<string, string>)Sends(_fcm).Single().GetArguments()[3]!;
        data.ContainsKey("type").ShouldBeFalse();
        data["path"].ShouldStartWith("/orders/editor/");
    }
}
