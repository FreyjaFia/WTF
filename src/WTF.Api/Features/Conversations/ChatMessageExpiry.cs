using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Conversations;

public sealed class ChatRetentionOptions
{
    public const string SectionName = "ChatRetention";

    public bool Enabled { get; set; } = true;

    /// <summary>
    /// A chat message is deleted this many days after it was sent, once its order is finished. <c>0</c> keeps messages
    /// for ever. A change applies at the next run.
    /// </summary>
    public int MessageDays { get; set; } = 90;

    public string TimeZoneId { get; set; } = "Asia/Manila";

    public int RunAtHour { get; set; } = 3;

    public int RunAtMinute { get; set; } = 0;

    /// <summary>Only count and log what would be deleted. On by default, so the first runs can be checked.</summary>
    public bool DryRun { get; set; } = true;

    /// <summary>Messages deleted per database statement, so a large backlog does not lock the table.</summary>
    public int BatchSize { get; set; } = 500;

    /// <summary>One run stops (and logs) after this many messages.</summary>
    public int MaxDeletesPerRun { get; set; } = 5000;

    public int RetryCount { get; set; } = 3;

    public int RetryDelayMinutes { get; set; } = 15;

    /// <summary>The number to tell people ("deleted after 90 days"), or null when messages are kept for ever.</summary>
    public int? DaysToShow => Enabled && MessageDays > 0 ? MessageDays : null;
}

public sealed record ChatMessageExpiryResult(
    DateTimeOffset RanAtUtc,
    bool DryRun,
    int MessageDays,
    int EligibleMessages,
    int DeletedMessages,
    int DeletedPhotos,
    int DeletedConversations,
    int Failed,
    bool CapReached,
    bool Skipped);

public interface IChatMessageExpiryService
{
    Task<ChatMessageExpiryResult> RunAsync(CancellationToken cancellationToken);

    /// <summary>The result of the last run, kept in report storage so it survives restarts (the app sleeps when idle).</summary>
    Task<ChatMessageExpiryResult?> GetLastRunAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Deletes old chat messages. A message expires <see cref="ChatRetentionOptions.MessageDays"/> after it was sent, but only
/// once its order is Completed, Cancelled or Refunded: the chat of an order that is still open is kept whatever its age.
/// Deleting chat never touches an order, its status or its history. A message's picture is deleted first, then the
/// message, so a failed delete leaves the message to be retried instead of a picture nothing points to.
/// </summary>
public sealed class ChatMessageExpiryService(
    WTFDbContext db,
    IReportFileStorage reportStorage,
    IOptions<ChatRetentionOptions> options,
    ILogger<ChatMessageExpiryService> logger,
    IChatImageService? chatImages = null) : IChatMessageExpiryService
{
    public const string StatePath = "system/chat-message-expiry.json";

    private static readonly int[] FinishedStatuses =
    [
        (int)OrderStatusEnum.Completed,
        (int)OrderStatusEnum.Cancelled,
        (int)OrderStatusEnum.Refunded
    ];

    public async Task<ChatMessageExpiryResult> RunAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var nowUtc = DateTimeOffset.UtcNow;
        if (!settings.Enabled || settings.MessageDays <= 0)
        {
            logger.LogInformation("Chat message expiry is off (Enabled={Enabled}, MessageDays={Days}).", settings.Enabled, settings.MessageDays);
            return new ChatMessageExpiryResult(nowUtc, settings.DryRun, settings.MessageDays, 0, 0, 0, 0, 0, false, true);
        }

        var cutoff = nowUtc.AddDays(-settings.MessageDays).UtcDateTime;
        var batchSize = Math.Max(1, settings.BatchSize);
        var cap = Math.Max(1, settings.MaxDeletesPerRun);

        // A message with no order behind it (a future support chat) has nothing keeping it open, so it expires by age.
        var expired = db.ConversationMessages.Where(m =>
            m.CreatedAt < cutoff
            && (m.Conversation.Order == null || FinishedStatuses.Contains(m.Conversation.Order.StatusId)));

        var eligible = await expired.CountAsync(cancellationToken);
        var deletedMessages = 0;
        var deletedPhotos = 0;
        var deletedConversations = 0;
        var failed = 0;
        var capReached = false;

        if (settings.DryRun)
        {
            var photos = await expired.CountAsync(m => m.ImageKey != null, cancellationToken);
            logger.LogInformation(
                "Chat message expiry (dry run) would delete {Messages} messages and {Photos} photos older than {Days} days from finished orders.",
                eligible, photos, settings.MessageDays);
            var preview = new ChatMessageExpiryResult(nowUtc, true, settings.MessageDays, eligible, Math.Min(eligible, cap), photos, 0, 0, eligible > cap, false);
            await SaveStateAsync(preview, cancellationToken);
            return preview;
        }

        // Messages whose picture could not be deleted stay for the next run, and are not picked again in this one.
        var skipped = new HashSet<Guid>();
        while (deletedMessages < cap)
        {
            var take = Math.Min(batchSize, cap - deletedMessages);
            var batch = await expired
                .Where(m => !skipped.Contains(m.Id))
                .OrderBy(m => m.CreatedAt).ThenBy(m => m.Id)
                .Take(take)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
            {
                break;
            }

            var deletable = new List<Domain.Entities.ConversationMessage>(batch.Count);
            var photosInBatch = 0;
            foreach (var message in batch)
            {
                if (message.ImageKey != null)
                {
                    if (chatImages == null)
                    {
                        skipped.Add(message.Id);
                        failed++;
                        continue;
                    }

                    try
                    {
                        await chatImages.DeleteAsync(message.ImageKey, cancellationToken);
                        photosInBatch++;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        skipped.Add(message.Id);
                        failed++;
                        logger.LogWarning(ex, "Chat message expiry could not delete the picture of message {MessageId}.", message.Id);
                        continue;
                    }
                }

                deletable.Add(message);
            }

            if (deletable.Count > 0)
            {
                db.ConversationMessages.RemoveRange(deletable);
                await db.SaveChangesAsync(cancellationToken);
                deletedMessages += deletable.Count;
                deletedPhotos += photosInBatch;
            }

            db.ChangeTracker.Clear();
        }

        capReached = deletedMessages >= cap && eligible > deletedMessages;

        // A conversation left with no messages goes too, so the envelope list shows no empty chats; "Chat with the shop"
        // starts a fresh one.
        var empty = await db.Conversations
            .Where(c => c.LastMessageAt < cutoff && !c.ConversationMessages.Any())
            .ToListAsync(cancellationToken);
        if (empty.Count > 0)
        {
            db.Conversations.RemoveRange(empty);
            await db.SaveChangesAsync(cancellationToken);
            deletedConversations = empty.Count;
            db.ChangeTracker.Clear();
        }

        if (capReached)
        {
            logger.LogWarning("Chat message expiry stopped at the limit of {Cap} messages per run; the rest waits for the next run.", cap);
        }

        var result = new ChatMessageExpiryResult(
            nowUtc, false, settings.MessageDays, eligible, deletedMessages, deletedPhotos, deletedConversations, failed, capReached, false);
        logger.LogInformation(
            "Chat message expiry finished: {Messages} messages, {Photos} photos and {Conversations} empty conversations deleted, {Failed} failed.",
            deletedMessages, deletedPhotos, deletedConversations, failed);

        await SaveStateAsync(result, cancellationToken);
        return result;
    }

    public async Task<ChatMessageExpiryResult?> GetLastRunAsync(CancellationToken cancellationToken)
    {
        var bytes = await reportStorage.ReadAllBytesAsync(StatePath, cancellationToken);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<ChatMessageExpiryResult>(bytes);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private Task SaveStateAsync(ChatMessageExpiryResult result, CancellationToken cancellationToken) =>
        reportStorage.SaveAsync(
            StatePath,
            JsonSerializer.SerializeToUtf8Bytes(result),
            "application/json",
            result.RanAtUtc,
            cancellationToken);
}

/// <summary>Runs the chat message expiry once a day, catching up after a cold start (see <see cref="DailyCatchUpScheduler"/>).</summary>
public sealed class ChatMessageExpiryScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<ChatRetentionOptions> options,
    ILogger<ChatMessageExpiryScheduler> logger) : DailyCatchUpScheduler(scopeFactory, logger)
{
    private ChatRetentionOptions Settings => options.Value;

    protected override string JobName => "Chat message expiry";
    protected override bool IsEnabled => Settings.Enabled && Settings.MessageDays > 0;
    protected override string TimeZoneId => Settings.TimeZoneId;
    protected override int RunAtHour => Settings.RunAtHour;
    protected override int RunAtMinute => Settings.RunAtMinute;
    protected override int RetryCount => Settings.RetryCount;
    protected override int RetryDelayMinutes => Settings.RetryDelayMinutes;

    protected override async Task<DateTimeOffset?> GetLastRunUtcAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        (await services.GetRequiredService<IChatMessageExpiryService>().GetLastRunAsync(cancellationToken))?.RanAtUtc;

    protected override Task RunJobAsync(IServiceProvider services, CancellationToken cancellationToken) =>
        services.GetRequiredService<IChatMessageExpiryService>().RunAsync(cancellationToken);
}
