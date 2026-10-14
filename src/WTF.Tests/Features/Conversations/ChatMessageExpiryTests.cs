using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Conversations;

public class ChatMessageExpiryTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly IReportFileStorage _reports = Substitute.For<IReportFileStorage>();
    private readonly Dictionary<string, byte[]> _photos = [];
    private readonly IChatImageService _images = Substitute.For<IChatImageService>();
    private byte[]? _state;
    private int _number = 1000;

    public ChatMessageExpiryTests()
    {
        _reports.SaveAsync(Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<string>(), Arg.Any<DateTimeOffset?>(), Arg.Any<CancellationToken>())
            .Returns(ci =>
            {
                _state = (byte[])ci[1];
                return Task.CompletedTask;
            });
        _reports.ReadAllBytesAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(_ => Task.FromResult(_state));
        _images.DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(ci =>
        {
            _photos.Remove((string)ci[0]);
            return Task.CompletedTask;
        });
    }

    private static ChatRetentionOptions Live() => new() { DryRun = false, MessageDays = 90 };

    private ChatMessageExpiryService Service(ChatRetentionOptions? options = null, bool withImages = true) =>
        new(TestDb.Create(_db), _reports, Options.Create(options ?? Live()), NullLogger<ChatMessageExpiryService>.Instance,
            withImages ? _images : null);

    /// <summary>A customer, an order in the given status and its chat with one message per given age (in days).</summary>
    private async Task<(Order Order, Conversation Conversation, List<ConversationMessage> Messages)> ChatAsync(
        OrderStatusEnum status, params int[] ageDays)
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = _number++,
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)status,
            CreatedAt = DateTime.UtcNow.AddDays(-200),
            CreatedBy = _staffId
        };
        var newest = ageDays.Min();
        var conversation = new Conversation
        {
            Id = Guid.NewGuid(),
            CustomerId = customer.Id,
            Kind = (byte)ConversationKind.Order,
            OrderId = order.Id,
            Title = ConversationRules.OrderTitle(order.OrderNumber),
            CreatedAt = DateTime.UtcNow.AddDays(-ageDays.Max()),
            LastMessageAt = DateTime.UtcNow.AddDays(-newest)
        };
        var messages = ageDays.Select(age => new ConversationMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            SenderType = (byte)MessageSender.Customer,
            Body = $"{age} days old",
            CreatedAt = DateTime.UtcNow.AddDays(-age)
        }).ToList();

        await TestDb.SaveAsync(_db, [customer, order, conversation, .. messages]);
        return (order, conversation, messages);
    }

    private async Task<List<string>> BodiesAsync()
    {
        await using var db = TestDb.Create(_db);
        return await db.ConversationMessages.OrderBy(m => m.CreatedAt).Select(m => m.Body).ToListAsync();
    }

    // ===== which messages go =====

    [Fact]
    public async Task AMessageJustBeforeTheLimitIsKept_AndOneJustAfterIsDeleted()
    {
        await ChatAsync(OrderStatusEnum.Completed, 89, 91);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(1);
        (await BodiesAsync()).ShouldBe(["89 days old"]);
    }

    [Theory]
    [InlineData(OrderStatusEnum.Completed)]
    [InlineData(OrderStatusEnum.Cancelled)]
    [InlineData(OrderStatusEnum.Refunded)]
    public async Task OldMessagesOfAFinishedOrderExpire(OrderStatusEnum status)
    {
        await ChatAsync(status, 120);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(1);
        (await BodiesAsync()).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(OrderStatusEnum.Pending)]
    [InlineData(OrderStatusEnum.PendingApproval)]
    public async Task TheChatOfAnOrderStillOpenIsKeptWhateverItsAge(OrderStatusEnum status)
    {
        await ChatAsync(status, 400, 200);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(0);
        (await BodiesAsync()).Count.ShouldBe(2);
    }

    [Fact]
    public async Task OnlyTheOldMessagesOfAFinishedOrderGo_AndItsConversationStays()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 200, 100, 5);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(2);
        result.DeletedConversations.ShouldBe(0);
        (await BodiesAsync()).ShouldBe(["5 days old"]);
        await using var db = TestDb.Create(_db);
        (await db.Conversations.AnyAsync(c => c.Id == conversation.Id)).ShouldBeTrue();
    }

    [Fact]
    public async Task AConversationLeftWithNoMessagesIsDeletedToo()
    {
        var (_, empty, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        var (_, kept, _) = await ChatAsync(OrderStatusEnum.Completed, 150, 3);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedConversations.ShouldBe(1);
        await using var db = TestDb.Create(_db);
        (await db.Conversations.AnyAsync(c => c.Id == empty.Id)).ShouldBeFalse();
        (await db.Conversations.AnyAsync(c => c.Id == kept.Id)).ShouldBeTrue();
    }

    [Fact]
    public async Task OrderLineAndSystemMessagesExpireWithTheRest_AndTheOrderIsNeverTouched()
    {
        var (order, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        await TestDb.SaveAsync(_db, new ConversationMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            SenderType = (byte)MessageSender.System,
            Body = "Order completed",
            CreatedAt = DateTime.UtcNow.AddDays(-150)
        });

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(2);
        await using var db = TestDb.Create(_db);
        var kept = await db.Orders.SingleAsync(o => o.Id == order.Id);
        kept.StatusId.ShouldBe((int)OrderStatusEnum.Completed);
        kept.CustomerId.ShouldBe(order.CustomerId);
    }

    // ===== pictures =====

    private async Task AddPhotoAsync(Conversation conversation, string key, int age)
    {
        _photos[key] = [1, 2, 3];
        await TestDb.SaveAsync(_db, new ConversationMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            SenderType = (byte)MessageSender.Customer,
            Body = "",
            CreatedAt = DateTime.UtcNow.AddDays(-age),
            ImageKey = key,
            ImageContentType = "image/jpeg",
            ImageWidth = 10,
            ImageHeight = 10,
            ImageSizeBytes = 3
        });
    }

    [Fact]
    public async Task APictureIsDeletedWithItsMessage()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        await AddPhotoAsync(conversation, "chat/a.jpg", 150);

        var result = await Service().RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(2);
        result.DeletedPhotos.ShouldBe(1);
        _photos.ShouldBeEmpty();
    }

    [Fact]
    public async Task APictureOfARecentMessageIsLeftAlone()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        await AddPhotoAsync(conversation, "chat/recent.jpg", 2);

        await Service().RunAsync(CancellationToken.None);

        _photos.Keys.ShouldBe(["chat/recent.jpg"]);
    }

    [Fact]
    public async Task AFailedPictureDelete_KeepsThatMessageForNextTime_AndTheOthersStillGo()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        await AddPhotoAsync(conversation, "chat/stuck.jpg", 150);
        await AddPhotoAsync(conversation, "chat/fine.jpg", 150);
        _images.DeleteAsync("chat/stuck.jpg", Arg.Any<CancellationToken>()).Returns(_ => Task.FromException(new IOException("down")));

        var result = await Service().RunAsync(CancellationToken.None);

        result.Failed.ShouldBe(1);
        result.DeletedPhotos.ShouldBe(1);
        result.DeletedMessages.ShouldBe(2, "the text message and the fine picture");
        await using var db = TestDb.Create(_db);
        (await db.ConversationMessages.SingleAsync()).ImageKey.ShouldBe("chat/stuck.jpg");
        (await db.Conversations.AnyAsync(c => c.Id == conversation.Id)).ShouldBeTrue("it still has a message");
    }

    [Fact]
    public async Task WithoutThePictureService_MessagesWithPicturesAreLeftAlone()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150);
        await AddPhotoAsync(conversation, "chat/a.jpg", 150);

        var result = await Service(withImages: false).RunAsync(CancellationToken.None);

        result.Failed.ShouldBe(1);
        (await BodiesAsync()).Count.ShouldBe(1);
        _photos.Count.ShouldBe(1);
    }

    // ===== settings and limits =====

    [Fact]
    public async Task ZeroDaysKeepsEverything()
    {
        await ChatAsync(OrderStatusEnum.Completed, 900);

        var result = await Service(new ChatRetentionOptions { DryRun = false, MessageDays = 0 }).RunAsync(CancellationToken.None);

        result.Skipped.ShouldBeTrue();
        (await BodiesAsync()).Count.ShouldBe(1);
    }

    [Fact]
    public async Task SwitchedOffDeletesNothing()
    {
        await ChatAsync(OrderStatusEnum.Completed, 900);

        var result = await Service(new ChatRetentionOptions { DryRun = false, Enabled = false }).RunAsync(CancellationToken.None);

        result.Skipped.ShouldBeTrue();
        (await BodiesAsync()).Count.ShouldBe(1);
    }

    [Fact]
    public async Task ADryRunCountsButDeletesNothing()
    {
        var (_, conversation, _) = await ChatAsync(OrderStatusEnum.Completed, 150, 160);
        await AddPhotoAsync(conversation, "chat/a.jpg", 150);

        var result = await Service(new ChatRetentionOptions { DryRun = true }).RunAsync(CancellationToken.None);

        result.DryRun.ShouldBeTrue();
        result.EligibleMessages.ShouldBe(3);
        result.DeletedPhotos.ShouldBe(1);
        (await BodiesAsync()).Count.ShouldBe(3);
        _photos.Count.ShouldBe(1);
        await _images.DidNotReceiveWithAnyArgs().DeleteAsync(default!, default);
    }

    [Fact]
    public async Task AnOldBacklogIsDeletedInSmallBatches()
    {
        await ChatAsync(OrderStatusEnum.Completed, 100, 101, 102, 103, 104, 105, 106);

        var result = await Service(new ChatRetentionOptions { DryRun = false, BatchSize = 2 }).RunAsync(CancellationToken.None);

        result.DeletedMessages.ShouldBe(7);
        result.CapReached.ShouldBeFalse();
        (await BodiesAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task TheCapStopsARun_AndTheRestWaitsForTheNextOne()
    {
        await ChatAsync(OrderStatusEnum.Completed, 100, 101, 102, 103, 104);

        var service = Service(new ChatRetentionOptions { DryRun = false, BatchSize = 2, MaxDeletesPerRun = 3 });
        var first = await service.RunAsync(CancellationToken.None);

        first.DeletedMessages.ShouldBe(3);
        first.CapReached.ShouldBeTrue();
        (await BodiesAsync()).Count.ShouldBe(2);

        var second = await Service(new ChatRetentionOptions { DryRun = false, BatchSize = 2, MaxDeletesPerRun = 3 })
            .RunAsync(CancellationToken.None);
        second.DeletedMessages.ShouldBe(2);
        second.CapReached.ShouldBeFalse();
        (await BodiesAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task EachRunSavesItsResultWhereTheSchedulerCanFindIt()
    {
        (await Service().GetLastRunAsync(CancellationToken.None)).ShouldBeNull();
        await ChatAsync(OrderStatusEnum.Completed, 150);

        await Service().RunAsync(CancellationToken.None);
        var last = await Service().GetLastRunAsync(CancellationToken.None);

        last.ShouldNotBeNull();
        last.DeletedMessages.ShouldBe(1);
        last.DryRun.ShouldBeFalse();
    }

    [Fact]
    public void Options_Defaults_MatchThePlan()
    {
        var o = new ChatRetentionOptions();

        o.MessageDays.ShouldBe(90);
        o.DryRun.ShouldBeTrue();
        o.BatchSize.ShouldBe(500);
        o.TimeZoneId.ShouldBe("Asia/Manila");
        o.DaysToShow.ShouldBe(90);
        new ChatRetentionOptions { MessageDays = 0 }.DaysToShow.ShouldBeNull();
        new ChatRetentionOptions { Enabled = false }.DaysToShow.ShouldBeNull();
        ChatRetentionOptions.SectionName.ShouldBe("ChatRetention");
    }

    // ===== people are told =====

    [Fact]
    public async Task TheChatTellsBothSidesHowLongMessagesAreKept()
    {
        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = "Maria",
            LastName = "Cruz",
            IsActive = true,
            AllowOrderingLink = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _staffId
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = 1,
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)OrderStatusEnum.Pending,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer, link, order);

        var staff = await new GetOrderConversationHandler(TestDb.Create(_db), Options.Create(new ChatRetentionOptions()))
            .Handle(new GetOrderConversationQuery(order.Id), default);
        var theirs = await new GetPublicOrderConversationHandler(TestDb.Create(_db), Options.Create(new ChatRetentionOptions()))
            .Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default);
        var kept = await new GetOrderConversationHandler(TestDb.Create(_db), Options.Create(new ChatRetentionOptions { MessageDays = 0 }))
            .Handle(new GetOrderConversationQuery(order.Id), default);

        staff!.RetentionDays.ShouldBe(90);
        theirs!.RetentionDays.ShouldBe(90);
        kept!.RetentionDays.ShouldBeNull();
    }

    // ===== the daily scheduler =====

    private static ChatMessageExpiryScheduler Scheduler(IChatMessageExpiryService service, ChatRetentionOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton(service);
        return new ChatMessageExpiryScheduler(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            Options.Create(options),
            NullLogger<ChatMessageExpiryScheduler>.Instance);
    }

    private static async Task RunBrieflyAsync(ChatMessageExpiryScheduler scheduler)
    {
        await scheduler.StartAsync(CancellationToken.None);
        await Task.Delay(300);
        await scheduler.StopAsync(CancellationToken.None);
    }

    private static ChatRetentionOptions UtcMidnight() => new() { TimeZoneId = "UTC", RunAtHour = 0, RunAtMinute = 0 };

    private static ChatMessageExpiryResult RanAt(DateTimeOffset when) =>
        new(when, false, 90, 0, 0, 0, 0, 0, false, false);

    [Fact]
    public async Task Scheduler_ColdStart_NeverRan_RunsAtOnce()
    {
        var service = Substitute.For<IChatMessageExpiryService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns((ChatMessageExpiryResult?)null);

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_ColdStart_LastRunYesterday_CatchesUp()
    {
        var service = Substitute.For<IChatMessageExpiryService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns(RanAt(DateTimeOffset.UtcNow.AddDays(-1)));

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_AlreadyRanToday_DoesNotRunAgain()
    {
        var service = Substitute.For<IChatMessageExpiryService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns(RanAt(DateTimeOffset.UtcNow));

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.DidNotReceive().RunAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Scheduler_KeepEverything_DoesNothingAtAll()
    {
        var service = Substitute.For<IChatMessageExpiryService>();

        await RunBrieflyAsync(Scheduler(service, new ChatRetentionOptions { TimeZoneId = "UTC", MessageDays = 0 }));

        await service.DidNotReceiveWithAnyArgs().RunAsync(default);
        await service.DidNotReceiveWithAnyArgs().GetLastRunAsync(default);
    }

    [Fact]
    public async Task Scheduler_AFailedRun_DoesNotStopTheHost()
    {
        var service = Substitute.For<IChatMessageExpiryService>();
        service.GetLastRunAsync(Arg.Any<CancellationToken>()).Returns((ChatMessageExpiryResult?)null);
        service.RunAsync(Arg.Any<CancellationToken>()).Returns<Task<ChatMessageExpiryResult>>(_ => throw new IOException("storage down"));

        await RunBrieflyAsync(Scheduler(service, UtcMidnight()));

        await service.Received(1).RunAsync(Arg.Any<CancellationToken>());
    }
}
