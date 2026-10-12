using Microsoft.Extensions.Options;
using SkiaSharp;

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

/// <summary>A picture the server refused. <see cref="Suspicious"/> means it looked hostile, not just too big or broken.</summary>
public sealed class ChatImageException(string message, bool suspicious = false) : InvalidOperationException(message)
{
    public bool Suspicious { get; } = suspicious;
}

/// <summary>A picture after processing: the bytes the server will store, never the sender's file.</summary>
public sealed record ProcessedChatImage(byte[] Data, string ContentType, int Width, int Height);

/// <summary>
/// Everything that happens to an upload before it is stored. The type is decided from the file's first bytes, the size
/// is checked before decoding, and the picture is decoded and written out again, so metadata (such as GPS) and anything
/// hidden in the original file are gone, and what is stored is a plain JPEG made here.
/// </summary>
public static class ChatImageProcessor
{
    public const string StoredContentType = "image/jpeg";

    public const string NotAnImageMessage = "That file is not a picture we accept. Please send a JPEG, PNG or WebP photo.";

    public static ProcessedChatImage Process(byte[] data, ChatImageOptions options)
    {
        if (data is null || data.Length == 0)
        {
            throw new ChatImageException("The picture is empty.");
        }

        if (data.Length > options.MaxBytes)
        {
            throw new ChatImageException(
                $"The picture is too big. The limit is {options.MaxBytes / (1024 * 1024)} MB.", suspicious: true);
        }

        if (!HasAllowedSignature(data))
        {
            throw new ChatImageException(NotAnImageMessage, suspicious: true);
        }

        try
        {
            using var codec = SKCodec.Create(new MemoryStream(data, writable: false));
            if (codec == null || codec.EncodedFormat is not (SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Png or SKEncodedImageFormat.Webp))
            {
                throw new ChatImageException(NotAnImageMessage, suspicious: true);
            }

            // The size is read from the header, so a small file that unpacks into a huge picture is stopped before decoding.
            var width = codec.Info.Width;
            var height = codec.Info.Height;
            if (width <= 0 || height <= 0 || width > options.MaxPixelsPerSide || height > options.MaxPixelsPerSide)
            {
                throw new ChatImageException(
                    $"The picture is too large. The limit is {options.MaxPixelsPerSide} x {options.MaxPixelsPerSide} pixels.",
                    suspicious: true);
            }

            using var decoded = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
            if (codec.GetPixels(decoded.Info, decoded.GetPixels()) != SKCodecResult.Success)
            {
                throw new ChatImageException("The picture is damaged or cannot be read.", suspicious: true);
            }

            // Turn it upright the way the camera meant (the orientation tag), then shrink it if it is big. A small
            // picture is never scaled up.
            var origin = codec.EncodedOrigin;
            var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
                or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
            var uprightWidth = swap ? height : width;
            var uprightHeight = swap ? width : height;
            var scale = Math.Min(1d, (double)options.StoredMaxSide / Math.Max(uprightWidth, uprightHeight));
            var outWidth = Math.Max(1, (int)Math.Round(uprightWidth * scale));
            var outHeight = Math.Max(1, (int)Math.Round(uprightHeight * scale));

            using var surface = SKSurface.Create(new SKImageInfo(outWidth, outHeight, SKColorType.Rgba8888, SKAlphaType.Premul));
            var canvas = surface.Canvas;
            canvas.Clear(SKColors.White);
            canvas.Scale((float)scale);
            canvas.Concat(UprightMatrix(origin, width, height));
            canvas.DrawBitmap(decoded, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));

            // Writing a fresh JPEG carries over no metadata (no GPS, camera or software tags) and nothing hidden in the original.
            using var image = surface.Snapshot();
            using var encoded = image.Encode(SKEncodedImageFormat.Jpeg, options.JpegQuality);
            if (encoded == null)
            {
                throw new ChatImageException("The picture is damaged or cannot be read.", suspicious: true);
            }

            return new ProcessedChatImage(encoded.ToArray(), StoredContentType, outWidth, outHeight);
        }
        catch (ChatImageException)
        {
            throw;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            throw new ChatImageException("The picture is damaged or cannot be read.", suspicious: true);
        }
    }

    /// <summary>The transform that draws a picture stored with the given orientation tag the right way up.</summary>
    private static SKMatrix UprightMatrix(SKEncodedOrigin origin, int width, int height) => origin switch
    {
        SKEncodedOrigin.TopRight => new SKMatrix(-1, 0, width, 0, 1, 0, 0, 0, 1),
        SKEncodedOrigin.BottomRight => new SKMatrix(-1, 0, width, 0, -1, height, 0, 0, 1),
        SKEncodedOrigin.BottomLeft => new SKMatrix(1, 0, 0, 0, -1, height, 0, 0, 1),
        SKEncodedOrigin.LeftTop => new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1),
        SKEncodedOrigin.RightTop => new SKMatrix(0, -1, height, 1, 0, 0, 0, 0, 1),
        SKEncodedOrigin.RightBottom => new SKMatrix(0, -1, height, -1, 0, width, 0, 0, 1),
        SKEncodedOrigin.LeftBottom => new SKMatrix(0, 1, 0, -1, 0, width, 0, 0, 1),
        _ => SKMatrix.Identity
    };

    /// <summary>JPEG, PNG or WebP by their first bytes. The file name and the declared type are never used.</summary>
    public static bool HasAllowedSignature(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            return true;
        }

        if (data.Length >= 8 && data[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return true;
        }

        return data.Length >= 12
            && data[..4].SequenceEqual("RIFF"u8)
            && data[8..12].SequenceEqual("WEBP"u8);
    }
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
