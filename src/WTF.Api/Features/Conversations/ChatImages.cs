using Microsoft.Extensions.Options;
using WTF.Api.Services;

namespace WTF.Api.Features.Conversations;

public sealed class ChatImageOptions
{
    public const string SectionName = "ChatImages";

    /// <summary>The largest upload accepted, before any processing.</summary>
    public int MaxBytes { get; set; } = 5 * 1024 * 1024;

    /// <summary>Wider or taller than this is refused without being decoded (a tiny file can unpack to a huge picture).</summary>
    public int MaxPixelsPerSide { get; set; } = 4096;

    /// <summary>Every picture is shrunk so its longer side is at most this.</summary>
    public int StoredMaxSide { get; set; } = 1600;

    public int JpegQuality { get; set; } = 82;

    /// <summary>Pictures one customer may send in 24 hours, over all their chats.</summary>
    public int DailyLimitPerCustomer { get; set; } = 30;

    /// <summary>The private container (Azure) that holds chat pictures. It is never public.</summary>
    public string Container { get; set; } = "wtf-chat-images";
}

/// <summary>The chat's own name for a refused picture, so callers can tell it from other uploads.</summary>
public sealed class ChatImageException(string message, bool suspicious = false) : ImageRejectedException(message, suspicious);

/// <summary>A picture after processing: the bytes the server will store, never the sender's file.</summary>
public sealed record ProcessedChatImage(byte[] Data, string ContentType, int Width, int Height);

/// <summary>
/// The chat's rules for an upload (see <see cref="ImageSanitizer"/> for what is checked and cleaned): always stored as a
/// JPEG on white, at most 1600 px, 4096 px per side.
/// </summary>
public static class ChatImageProcessor
{
    public const string StoredContentType = "image/jpeg";

    public const string NotAnImageMessage = ImageSanitizer.NotAnImageMessage;

    public static ProcessedChatImage Process(byte[] data, ChatImageOptions options)
    {
        try
        {
            var result = ImageSanitizer.Process(data, new ImageRules(
                MaxBytes: options.MaxBytes,
                MaxPixelsPerSide: options.MaxPixelsPerSide,
                MaxTotalPixels: (long)options.MaxPixelsPerSide * options.MaxPixelsPerSide,
                MaxOutputSide: options.StoredMaxSide,
                JpegQuality: options.JpegQuality,
                ForceJpeg: true));
            return new ProcessedChatImage(result.Data, result.ContentType, result.Width, result.Height);
        }
        catch (ChatImageException)
        {
            throw;
        }
        catch (ImageRejectedException ex)
        {
            throw new ChatImageException(ex.Message, ex.Suspicious);
        }
    }

    public static bool HasAllowedSignature(ReadOnlySpan<byte> data) => ImageSanitizer.HasAllowedSignature(data);
}

/// <summary>Where chat pictures are kept. A private place: nothing here has a public address.</summary>
public interface IChatImageStore
{
    Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken);
    Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

/// <summary>What the chat handlers use: process an upload, keep it, read it back, remove it.</summary>
public interface IChatImageService
{
    int DailyLimitPerCustomer { get; }

    /// <summary>Checks and re-encodes an upload. Throws <see cref="ChatImageException"/> when it is refused.</summary>
    ProcessedChatImage Prepare(byte[] data);

    /// <summary>Stores a processed picture under a random name and returns that name (the key).</summary>
    Task<string> SaveAsync(Guid conversationId, ProcessedChatImage image, CancellationToken cancellationToken);

    Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken);

    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

public sealed class ChatImageService(IChatImageStore store, IOptions<ChatImageOptions> options) : IChatImageService
{
    public int DailyLimitPerCustomer => options.Value.DailyLimitPerCustomer;

    public ProcessedChatImage Prepare(byte[] data) => ChatImageProcessor.Process(data, options.Value);

    public async Task<string> SaveAsync(Guid conversationId, ProcessedChatImage image, CancellationToken cancellationToken)
    {
        // A random server-made name. The sender's file name is never stored or shown.
        var key = $"chat/{conversationId:N}/{Guid.NewGuid():N}.jpg";
        await store.SaveAsync(key, image.Data, image.ContentType, cancellationToken);
        return key;
    }

    public Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken) => store.ReadAsync(key, cancellationToken);

    public Task DeleteAsync(string key, CancellationToken cancellationToken) => store.DeleteAsync(key, cancellationToken);
}

/// <summary>A stored picture read back to be sent to the screen.</summary>
public record ChatImageFile(byte[] Data, string ContentType);
