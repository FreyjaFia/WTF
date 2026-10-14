using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NSubstitute;
using SkiaSharp;
using WTF.Api.Common.Auth;
using WTF.Api.Endpoints;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Conversations;

public class ChatImageTests
{
    // ---- picture bytes -------------------------------------------------------------------------

    private static byte[] Picture(string format, int width = 40, int height = 30, SKColor? colour = null)
    {
        using var bitmap = new SKBitmap(width, height);
        bitmap.Erase(colour ?? new SKColor(200, 30, 30, 255));
        using var image = SKImage.FromBitmap(bitmap);
        var skFormat = format switch
        {
            "png" => SKEncodedImageFormat.Png,
            "webp" => SKEncodedImageFormat.Webp,
            _ => SKEncodedImageFormat.Jpeg
        };
        return image.Encode(skFormat, 90).ToArray();
    }

    private static SKEncodedImageFormat FormatOf(byte[] data)
    {
        using var codec = SKCodec.Create(new MemoryStream(data));
        return codec.EncodedFormat;
    }

    /// <summary>A JPEG that carries an Exif block (inserted right after the start marker) with the given tags.</summary>
    private static byte[] WithExif(byte[] jpeg, string note, ushort? orientation = null)
    {
        var text = System.Text.Encoding.ASCII.GetBytes(note + "\0");
        var entries = new List<byte[]>();
        if (orientation.HasValue)
        {
            entries.Add([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, (byte)(orientation.Value >> 8), (byte)orientation.Value, 0, 0]);
        }

        // ImageDescription (0x010E), ASCII, stored after the directory.
        var dirSize = 2 + ((entries.Count + 1) * 12) + 4;
        var textOffset = 8 + dirSize;
        entries.Add([0x01, 0x0E, 0x00, 0x02, 0, 0, (byte)(text.Length >> 8), (byte)text.Length,
            (byte)(textOffset >> 24), (byte)(textOffset >> 16), (byte)(textOffset >> 8), (byte)textOffset]);

        var tiff = new List<byte> { (byte)'M', (byte)'M', 0, 0x2A, 0, 0, 0, 8, 0, (byte)entries.Count };
        entries.ForEach(e => tiff.AddRange(e));
        tiff.AddRange(new byte[] { 0, 0, 0, 0 });
        tiff.AddRange(text);

        var payload = new List<byte>("Exif\0\0"u8.ToArray());
        payload.AddRange(tiff);
        var length = payload.Count + 2;
        var segment = new List<byte> { 0xFF, 0xE1, (byte)(length >> 8), (byte)length };
        segment.AddRange(payload);

        var result = new List<byte> { 0xFF, 0xD8 };
        result.AddRange(segment);
        result.AddRange(jpeg.Skip(2));
        return result.ToArray();
    }

    private static readonly ChatImageOptions Limits = new();

    private static ProcessedChatImage Process(byte[] data, ChatImageOptions? options = null) =>
        ChatImageProcessor.Process(data, options ?? Limits);

    private static ChatImageException Refused(byte[] data, ChatImageOptions? options = null) =>
        Should.Throw<ChatImageException>(() => Process(data, options));

    // ===== the processor =====

    [Theory]
    [InlineData("jpeg")]
    [InlineData("png")]
    [InlineData("webp")]
    public void Processor_AcceptsJpegPngAndWebp_AndStoresAJpeg(string format)
    {
        var result = Process(Picture(format));

        result.ContentType.ShouldBe("image/jpeg");
        result.Width.ShouldBe(40);
        result.Height.ShouldBe(30);
        FormatOf(result.Data).ShouldBe(SKEncodedImageFormat.Jpeg);
    }

    [Fact]
    public void Processor_ShrinksALargePictureToTheStoredSize_KeepingTheShape()
    {
        var result = Process(Picture("jpeg", 3200, 2000));

        result.Width.ShouldBe(1600);
        result.Height.ShouldBe(1000);
    }

    [Fact]
    public void Processor_RemovesMetadataSuchAsGps()
    {
        var original = WithExif(Picture("jpeg"), "secret-camera-app");
        System.Text.Encoding.Latin1.GetString(original).ShouldContain("secret-camera-app", Case.Sensitive);
        original.AsSpan().IndexOf(new byte[] { 0xFF, 0xE1 }).ShouldBeGreaterThanOrEqualTo(0);

        var result = Process(original);

        System.Text.Encoding.Latin1.GetString(result.Data).ShouldNotContain("secret-camera-app");
        System.Text.Encoding.Latin1.GetString(result.Data).ShouldNotContain("Exif");
        result.Data.AsSpan().IndexOf(new byte[] { 0xFF, 0xE1 }).ShouldBe(-1);
    }

    [Fact]
    public void Processor_TurnsAPictureUprightFromItsOrientationTag()
    {
        // Orientation 6 = the camera was held sideways: a 40 x 30 file is really 30 wide and 40 high.
        var result = Process(WithExif(Picture("jpeg", 40, 30), "x", orientation: 6));

        result.Width.ShouldBe(30);
        result.Height.ShouldBe(40);
    }

    [Fact]
    public void Processor_FlattensTransparencyOntoWhite()
    {
        var result = Process(Picture("png", 8, 8, SKColors.Transparent));

        using var decoded = SKBitmap.Decode(result.Data);
        var pixel = decoded.GetPixel(4, 4);
        pixel.Red.ShouldBeGreaterThan((byte)240);
        pixel.Green.ShouldBeGreaterThan((byte)240);
        pixel.Blue.ShouldBeGreaterThan((byte)240);
    }

    [Fact]
    public void Processor_DecidesTheTypeFromTheBytes_NotTheName_SoAScriptRenamedToJpgIsRefused()
    {
        var script = "<script>alert(1)</script>"u8.ToArray();

        var error = Refused(script);

        error.Suspicious.ShouldBeTrue();
        error.Message.ShouldBe(ChatImageProcessor.NotAnImageMessage);
    }

    [Fact]
    public void Processor_RefusesSvg()
    {
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();

        Refused(svg).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void Processor_RefusesGif()
    {
        var gif = "GIF89a\x01\0\x01\0\0\0\0;"u8.ToArray();

        Refused(gif).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void Processor_RefusesADisguisedExecutable()
    {
        var exe = new byte[2048];
        exe[0] = (byte)'M';
        exe[1] = (byte)'Z';

        Refused(exe).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void Processor_RefusesAnExecutableHiddenBehindAPictureHeader()
    {
        // Starts like a JPEG but is not one.
        var data = new byte[4096];
        data[0] = 0xFF;
        data[1] = 0xD8;
        data[2] = 0xFF;
        new Random(1).NextBytes(data.AsSpan(3));

        Refused(data).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void Processor_RefusesAFileOverTheSizeLimit()
    {
        var options = new ChatImageOptions { MaxBytes = 1000 };
        var big = Picture("png", 400, 400);
        big.Length.ShouldBeGreaterThan(1000);

        var error = Refused(big, options);

        error.Message.ShouldContain("too big");
    }

    [Fact]
    public void Processor_RefusesPicturesOverThePixelLimit_WithoutDecodingThem()
    {
        var options = new ChatImageOptions { MaxPixelsPerSide = 100 };

        var error = Refused(Picture("png", 101, 10), options);

        error.Message.ShouldContain("too large");
    }

    [Fact]
    public void Processor_RefusesACorruptPicture()
    {
        var corrupt = Picture("png", 200, 200);
        for (var i = 60; i < corrupt.Length - 20; i++)
        {
            corrupt[i] = 0x13;
        }

        Refused(corrupt).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void Processor_RefusesNothingAtAll()
    {
        Should.Throw<ChatImageException>(() => Process([]));
    }

    // ===== both sides =====

    private sealed class MemoryChatImageStore : IChatImageStore
    {
        public Dictionary<string, byte[]> Files { get; } = [];

        public Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken)
        {
            Files[key] = data;
            return Task.CompletedTask;
        }

        public Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(key, out var data) ? data : null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            Files.Remove(key);
            return Task.CompletedTask;
        }
    }

    private readonly string _db = TestDb.NewName();
    private readonly Guid _staffId = Guid.NewGuid();
    private readonly Guid _systemUserId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly IConversationNotifier _notifier = Substitute.For<IConversationNotifier>();
    private readonly MemoryChatImageStore _store = new();
    private ChatImageOptions _options = new();

    private IChatImageService Images() => new ChatImageService(_store, Options.Create(_options));

    private SendPublicMessageHandler PublicSend() =>
        new(TestDb.Create(_db), _audit, _notifier, TimeProvider.System, Images());

    private SendStaffMessageHandler StaffSend() =>
        new(TestDb.Create(_db), TestRequest.As(_staffId, AppRoles.Cashier), _audit, _notifier, Images());

    private RemovePublicMessageImageHandler PublicRemove() =>
        new(TestDb.Create(_db), _audit, _notifier, TimeProvider.System, Images());

    private RemoveMessageImageHandler Remove() =>
        new(TestDb.Create(_db), TestRequest.As(_staffId, AppRoles.Cashier), _audit, _notifier, TimeProvider.System, Images());

    private GetPublicMessageImageHandler PublicImage() => new(TestDb.Create(_db), Images());

    private GetMessageImageHandler StaffImage() => new(TestDb.Create(_db), Images());

    private async Task<(Customer Customer, ShortLink Link, Order Order)> SeedAsync(
        string first = "Maria", OrderStatusEnum status = OrderStatusEnum.Pending, int number = 1042, bool revoked = false)
    {
        if (!await TestDbHasUsersAsync())
        {
            await TestDb.SaveAsync(_db,
                new User
                {
                    Id = _staffId,
                    Username = "ana",
                    PasswordHash = "x",
                    FirstName = "Ana",
                    LastName = "Reyes",
                    IsActive = true,
                    RoleId = 2,
                    CreatedAt = DateTime.UtcNow,
                    CreatedBy = _staffId
                },
                new User
                {
                    Id = _systemUserId,
                    Username = SubmitPublicOrderHandler.SystemUsername,
                    PasswordHash = "x",
                    FirstName = "Customer",
                    LastName = "Link",
                    IsActive = false,
                    RoleId = 2,
                    CreatedAt = DateTime.UtcNow,
                    CreatedBy = _staffId
                });
        }

        var customer = new Customer
        {
            Id = Guid.NewGuid(),
            FirstName = first,
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
            RevokedAt = revoked ? DateTime.UtcNow : null,
            CreatedAt = DateTime.UtcNow.AddHours(-1),
            CreatedBy = _staffId
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            OrderNumber = number,
            CustomerId = customer.Id,
            Source = (byte)OrderSourceEnum.CustomerLink,
            StatusId = (int)status,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = _staffId
        };
        await TestDb.SaveAsync(_db, customer, link, order);
        return (customer, link, order);
    }

    private async Task<bool> TestDbHasUsersAsync()
    {
        await using var db = TestDb.Create(_db);
        return await db.Users.AnyAsync();
    }

    private async Task<List<ConversationMessage>> MessagesAsync()
    {
        await using var db = TestDb.Create(_db);
        return await db.ConversationMessages.OrderBy(m => m.CreatedAt).ToListAsync();
    }

    // ---- customer sends ----

    [Fact]
    public async Task Customer_SendsAPictureWithACaption_StoredAsOurOwnJpegUnderARandomName()
    {
        var (_, link, order) = await SeedAsync();

        var dto = await PublicSend().Handle(
            new SendPublicMessageCommand(link.Token, order.Id, "  GCash payment  ", Picture("png", 3200, 2000)), default);

        dto.ShouldNotBeNull();
        dto.HasImage.ShouldBeTrue();
        dto.Body.ShouldBe("GCash payment");
        dto.ImageWidth.ShouldBe(1600);
        dto.ImageHeight.ShouldBe(1000);
        dto.ImageRemoved.ShouldBeFalse();

        var message = (await MessagesAsync()).Single();
        message.ImageKey.ShouldNotBeNull();
        message.ImageKey.ShouldStartWith("chat/");
        message.ImageKey.ShouldEndWith(".jpg");
        message.ImageContentType.ShouldBe("image/jpeg");
        message.ImageSizeBytes.ShouldBe(_store.Files[message.ImageKey].Length);
        _store.Files.Count.ShouldBe(1);
        FormatOf(_store.Files[message.ImageKey]).ShouldBe(SKEncodedImageFormat.Jpeg);
    }

    [Fact]
    public async Task APictureMessage_IsAnnouncedLive_LikeText_FromEitherSide()
    {
        var (_, link, order) = await SeedAsync();

        await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);
        await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "", Picture("jpeg")), default);

        await _notifier.Received(2).MessageSentAsync(
            Arg.Any<Order>(), Arg.Any<Conversation>(),
            Arg.Is<ConversationMessage>(m => m.ImageKey != null),
            Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Customer_PictureWithoutText_IsAllowed_AndPushesSentAPhoto()
    {
        var (_, link, order) = await SeedAsync();

        var dto = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);

        dto.ShouldNotBeNull();
        dto.Body.ShouldBe("");
        (await MessagesAsync()).Single().Body.ShouldBe("");
        ConversationRules.PreviewOf("", true).ShouldBe("Sent a photo");
    }

    [Fact]
    public async Task Customer_PlainTextStillNeedsText()
    {
        var (_, link, order) = await SeedAsync();

        await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "   "), default));
    }

    [Fact]
    public async Task Customer_HostileFile_IsRefused_RecordedInTheAuditLog_AndNothingIsSaved()
    {
        var (_, link, order) = await SeedAsync();

        var error = await Should.ThrowAsync<ChatImageException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", "<script>x</script>"u8.ToArray()), default));

        error.Message.ShouldBe(ChatImageProcessor.NotAnImageMessage);
        (await MessagesAsync()).ShouldBeEmpty();
        _store.Files.ShouldBeEmpty();
        await _audit.Received(1).LogAsync(
            AuditAction.ChatImageRejected, AuditEntityType.Conversation, Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), _systemUserId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Customer_TooBigFile_IsRefusedWithAClearMessage()
    {
        var (_, link, order) = await SeedAsync();
        _options = new ChatImageOptions { MaxBytes = 500 };

        var error = await Should.ThrowAsync<ChatImageException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("png", 300, 300)), default));

        error.Message.ShouldContain("too big");
        _store.Files.ShouldBeEmpty();
    }

    [Fact]
    public async Task Customer_RevokedLink_GetsNotFound_AndNoFileIsKept()
    {
        var (_, link, order) = await SeedAsync(revoked: true);

        var dto = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);

        dto.ShouldBeNull();
        _store.Files.ShouldBeEmpty();
        (await MessagesAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Customer_AnotherCustomersOrder_IsNotFound()
    {
        var (_, link, _) = await SeedAsync();
        var (_, _, strangersOrder) = await SeedAsync("Ben", number: 2000);

        var dto = await PublicSend().Handle(
            new SendPublicMessageCommand(link.Token, strangersOrder.Id, "", Picture("jpeg")), default);

        dto.ShouldBeNull();
        _store.Files.ShouldBeEmpty();
    }

    [Fact]
    public async Task Customer_ClosedOrder_AcceptsNoPictures_SameAsText()
    {
        var (_, link, order) = await SeedAsync(status: OrderStatusEnum.Completed);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default));

        _store.Files.ShouldBeEmpty();
    }

    [Fact]
    public async Task Customer_DailyPictureLimit_StopsFurtherPictures_ButNotText()
    {
        var (_, link, order) = await SeedAsync();
        _options = new ChatImageOptions { DailyLimitPerCustomer = 2 };

        await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);
        await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);

        var error = await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default));
        error.Message.ShouldContain("photos");
        _store.Files.Count.ShouldBe(2);

        var text = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "hello"), default);
        text.ShouldNotBeNull();
    }

    [Fact]
    public async Task Customer_PicturesCountTowardsTheTenMessagesBeforeTheShopReplies()
    {
        var (_, link, order) = await SeedAsync();
        for (var i = 0; i < ConversationRules.MaxUnansweredCustomerMessages; i++)
        {
            await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);
        }

        var error = await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default));
        error.Message.ShouldContain("wait for the shop");
    }

    [Fact]
    public async Task Customer_WithoutThePictureService_CannotSendPictures()
    {
        var (_, link, order) = await SeedAsync();
        var handler = new SendPublicMessageHandler(TestDb.Create(_db), _audit, _notifier, TimeProvider.System);

        await Should.ThrowAsync<InvalidOperationException>(() =>
            handler.Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default));
    }

    // ---- staff sends and removes ----

    [Fact]
    public async Task Staff_SendsAPicture_AndTheCustomerCanSeeItThroughTheirLink()
    {
        var (_, link, order) = await SeedAsync();

        var dto = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "Your drink", Picture("jpeg")), default);

        dto.ShouldNotBeNull();
        dto.HasImage.ShouldBeTrue();
        dto.Sender.ShouldBe("staff");

        var file = await PublicImage().Handle(new GetPublicMessageImageQuery(link.Token, order.Id, dto.Id), default);
        file.ShouldNotBeNull();
        file.ContentType.ShouldBe("image/jpeg");
        file.Data.Length.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Staff_HostileFile_IsRefusedAndRecordedUnderTheStaffMember()
    {
        var (_, _, order) = await SeedAsync();

        await Should.ThrowAsync<ChatImageException>(() =>
            StaffSend().Handle(new SendStaffMessageCommand(order.Id, "", "MZ"u8.ToArray()), default));

        await _audit.Received(1).LogAsync(
            AuditAction.ChatImageRejected, AuditEntityType.Conversation, Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), _staffId, Arg.Any<CancellationToken>());
        _store.Files.ShouldBeEmpty();
    }

    [Fact]
    public async Task Image_AnotherCustomerOrARevokedLink_GetsNothing()
    {
        var (_, link, order) = await SeedAsync();
        var (_, strangersLink, _) = await SeedAsync("Ben", number: 2000);
        var (_, revokedLink, _) = await SeedAsync("Rita", number: 3000, revoked: true);
        var dto = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "", Picture("jpeg")), default);

        (await PublicImage().Handle(new GetPublicMessageImageQuery(link.Token, order.Id, dto!.Id), default)).ShouldNotBeNull();
        (await PublicImage().Handle(new GetPublicMessageImageQuery(strangersLink.Token, order.Id, dto.Id), default)).ShouldBeNull();
        (await PublicImage().Handle(new GetPublicMessageImageQuery(revokedLink.Token, order.Id, dto.Id), default)).ShouldBeNull();
        (await PublicImage().Handle(new GetPublicMessageImageQuery("not-a-token", order.Id, dto.Id), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Image_AMessageIdFromAnotherOrder_GetsNothing()
    {
        var (_, link, order) = await SeedAsync();
        var (_, _, otherOrder) = await SeedAsync("Ben", number: 2000);
        var dto = await StaffSend().Handle(new SendStaffMessageCommand(otherOrder.Id, "", Picture("jpeg")), default);

        (await PublicImage().Handle(new GetPublicMessageImageQuery(link.Token, order.Id, dto!.Id), default)).ShouldBeNull();
        (await StaffImage().Handle(new GetMessageImageQuery(order.Id, dto.Id), default)).ShouldBeNull();
        (await StaffImage().Handle(new GetMessageImageQuery(otherOrder.Id, dto.Id), default)).ShouldNotBeNull();
    }

    [Fact]
    public async Task Staff_RemovesAPicture_FileAndDetailsGo_TheMessageStaysAsPhotoRemoved()
    {
        var (_, link, order) = await SeedAsync();
        var sent = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "proof", Picture("jpeg")), default);
        _store.Files.Count.ShouldBe(1);

        var dto = await Remove().Handle(new RemoveMessageImageCommand(order.Id, sent!.Id), default);

        dto.ShouldNotBeNull();
        dto.HasImage.ShouldBeFalse();
        dto.ImageRemoved.ShouldBeTrue();
        dto.Body.ShouldBe("proof");
        _store.Files.ShouldBeEmpty();

        var message = (await MessagesAsync()).Single();
        message.ImageKey.ShouldBeNull();
        message.ImageWidth.ShouldBeNull();
        message.ImageRemovedAt.ShouldNotBeNull();

        await _audit.Received(1).LogAsync(
            AuditAction.ChatImageRemoved, AuditEntityType.Conversation, Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), _staffId, Arg.Any<CancellationToken>());
        await _notifier.Received(1).OrderChangedAsync(Arg.Any<Order>(), Arg.Any<Conversation?>(), Arg.Any<CancellationToken>());

        (await PublicImage().Handle(new GetPublicMessageImageQuery(link.Token, order.Id, sent.Id), default)).ShouldBeNull();
        (await Remove().Handle(new RemoveMessageImageCommand(order.Id, sent.Id), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Customer_RemovesTheirOwnPicture_FileGoesAndTheMessageStaysAsPhotoRemoved()
    {
        var (_, link, order) = await SeedAsync();
        var sent = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "proof", Picture("jpeg")), default);
        _store.Files.Count.ShouldBe(1);

        var dto = await PublicRemove().Handle(new RemovePublicMessageImageCommand(link.Token, order.Id, sent!.Id), default);

        dto.ShouldNotBeNull();
        dto.ImageRemoved.ShouldBeTrue();
        dto.HasImage.ShouldBeFalse();
        dto.Body.ShouldBe("proof");
        _store.Files.ShouldBeEmpty();
        (await MessagesAsync()).Single().ImageRemovedAt.ShouldNotBeNull();
        await _audit.Received(1).LogAsync(
            AuditAction.ChatImageRemoved, AuditEntityType.Conversation, Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), _systemUserId, Arg.Any<CancellationToken>());
        await _notifier.Received(1).OrderChangedAsync(Arg.Any<Order>(), Arg.Any<Conversation?>(), Arg.Any<CancellationToken>());
        (await PublicRemove().Handle(new RemovePublicMessageImageCommand(link.Token, order.Id, sent.Id), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Customer_CannotRemoveTheShopsPicture()
    {
        var (_, link, order) = await SeedAsync();
        var fromShop = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "", Picture("jpeg")), default);

        (await PublicRemove().Handle(new RemovePublicMessageImageCommand(link.Token, order.Id, fromShop!.Id), default)).ShouldBeNull();

        _store.Files.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Customer_CannotRemoveAnotherCustomersPicture_OrUseARevokedLink()
    {
        var (_, link, order) = await SeedAsync();
        var (_, strangersLink, _) = await SeedAsync("Ben", number: 2000);
        var (_, revokedLink, revokedOrder) = await SeedAsync("Rita", number: 3000, revoked: true);
        var sent = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);

        (await PublicRemove().Handle(new RemovePublicMessageImageCommand(strangersLink.Token, order.Id, sent!.Id), default)).ShouldBeNull();
        (await PublicRemove().Handle(new RemovePublicMessageImageCommand(revokedLink.Token, revokedOrder.Id, sent.Id), default)).ShouldBeNull();
        (await PublicRemove().Handle(new RemovePublicMessageImageCommand("not-a-token", order.Id, sent.Id), default)).ShouldBeNull();

        _store.Files.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Customer_CannotChangeAFinishedOrdersChat()
    {
        var (_, link, order) = await SeedAsync();
        var sent = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);
        await using (var db = TestDb.Create(_db))
        {
            var row = await db.Orders.SingleAsync(o => o.Id == order.Id);
            row.StatusId = (int)OrderStatusEnum.Completed;
            await db.SaveChangesAsync();
        }

        await Should.ThrowAsync<InvalidOperationException>(() =>
            PublicRemove().Handle(new RemovePublicMessageImageCommand(link.Token, order.Id, sent!.Id), default));

        _store.Files.Count.ShouldBe(1);
    }

    [Fact]
    public async Task Staff_RemoveOfAMessageWithoutAPicture_IsNotFound()
    {
        var (_, _, order) = await SeedAsync();
        var text = await StaffSend().Handle(new SendStaffMessageCommand(order.Id, "hello"), default);

        (await Remove().Handle(new RemoveMessageImageCommand(order.Id, text!.Id), default)).ShouldBeNull();
    }

    [Fact]
    public async Task Lists_ShowSentAPhoto_ForAPictureWithoutText_AndPhotoRemovedAfterwards()
    {
        var (_, link, order) = await SeedAsync();
        var sent = await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg")), default);

        await using (var db = TestDb.Create(_db))
        {
            (await ConversationStore.ListAsync(db, null, default)).Items.Single().LastMessage.ShouldBe("Sent a photo");
        }

        await Remove().Handle(new RemoveMessageImageCommand(order.Id, sent!.Id), default);

        await using (var db = TestDb.Create(_db))
        {
            (await ConversationStore.ListAsync(db, null, default)).Items.Single().LastMessage.ShouldBe("Photo removed");
        }
    }

    [Fact]
    public async Task OpeningTheChat_ReportsWhichMessagesHavePictures_WithTheirSize()
    {
        var (_, link, order) = await SeedAsync();
        await PublicSend().Handle(new SendPublicMessageCommand(link.Token, order.Id, "", Picture("jpeg", 60, 20)), default);

        var chat = await new GetPublicOrderConversationHandler(TestDb.Create(_db))
            .Handle(new GetPublicOrderConversationQuery(link.Token, order.Id), default);

        var message = chat!.Messages.Single();
        message.HasImage.ShouldBeTrue();
        message.ImageWidth.ShouldBe(60);
        message.ImageHeight.ShouldBe(20);
    }

    // ===== upload reading and the response =====

    [Fact]
    public async Task Upload_AnEmptyFileOrNoFile_IsRefused()
    {
        await Should.ThrowAsync<InvalidOperationException>(() => ChatImageUploads.ReadAsync(null, new ChatImageOptions()));

        var empty = Substitute.For<IFormFile>();
        empty.Length.Returns(0);
        await Should.ThrowAsync<InvalidOperationException>(() => ChatImageUploads.ReadAsync(empty, new ChatImageOptions()));
    }

    [Fact]
    public async Task Upload_AFileOverTheLimit_IsRefusedBeforeItIsRead()
    {
        var big = Substitute.For<IFormFile>();
        big.Length.Returns(10 * 1024 * 1024);

        var error = await Should.ThrowAsync<InvalidOperationException>(() =>
            ChatImageUploads.ReadAsync(big, new ChatImageOptions()));

        error.Message.ShouldContain("too big");
        await big.DidNotReceiveWithAnyArgs().CopyToAsync(default!, default);
    }

    [Fact]
    public void Serve_SendsOurContentType_NoSniffing_Inline_AndPrivateCaching()
    {
        var http = new DefaultHttpContext();

        var result = ChatImageUploads.Serve(http, new ChatImageFile([1, 2, 3], "image/jpeg"));

        result.ShouldNotBeNull();
        http.Response.Headers["X-Content-Type-Options"].ToString().ShouldBe("nosniff");
        http.Response.Headers.ContentDisposition.ToString().ShouldBe("inline");
        http.Response.Headers.CacheControl.ToString().ShouldContain("private");
    }

    [Fact]
    public void Serve_NothingToSend_IsNotFound()
    {
        ChatImageUploads.Serve(new DefaultHttpContext(), null).ShouldBeOfType<Microsoft.AspNetCore.Http.HttpResults.NotFound>();
    }

    [Fact]
    public void Rules_CaptionMayBeEmptyButNotTooLong()
    {
        ConversationRules.NormalizeCaption("  ").ShouldBe("");
        ConversationRules.NormalizeCaption(null).ShouldBe("");
        Should.Throw<InvalidOperationException>(() => ConversationRules.NormalizeCaption(new string('a', 1001)));
        ConversationRules.PreviewOf("hello", true).ShouldBe("hello");
        ConversationRules.PreviewOf("", true, imageRemoved: true).ShouldBe("Photo removed");
        ConversationRules.PreviewOf("", false).ShouldBe("");
    }

    [Fact]
    public void Options_Defaults_MatchThePlan()
    {
        var o = new ChatImageOptions();

        o.MaxBytes.ShouldBe(5 * 1024 * 1024);
        o.MaxPixelsPerSide.ShouldBe(4096);
        o.StoredMaxSide.ShouldBe(1600);
        o.DailyLimitPerCustomer.ShouldBe(30);
        ChatImageOptions.SectionName.ShouldBe("ChatImages");
    }
}
