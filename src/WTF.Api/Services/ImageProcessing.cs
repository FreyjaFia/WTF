using SkiaSharp;

namespace WTF.Api.Services;

/// <summary>A picture the server refused. <see cref="Suspicious"/> means it looked hostile, not just too big or broken.</summary>
public class ImageRejectedException(string message, bool suspicious = false) : InvalidOperationException(message)
{
    public bool Suspicious { get; } = suspicious;
}

/// <summary>What to accept and what to make of it. See <see cref="ImageSanitizer"/>.</summary>
/// <param name="MaxBytes">The largest upload, checked before anything is decoded.</param>
/// <param name="MaxPixelsPerSide">Wider or taller than this is refused without being decoded.</param>
/// <param name="MaxTotalPixels">More pixels than this (width x height) is refused without being decoded.</param>
/// <param name="MaxOutputSide">A bigger picture is shrunk so its longer side is this. A smaller one is never scaled up.</param>
/// <param name="JpegQuality">Quality of a JPEG (or lossy WebP) that is written.</param>
/// <param name="ForceJpeg">Always store a JPEG on white. Otherwise the picture keeps its own format and transparency.</param>
public sealed record ImageRules(
    int MaxBytes,
    int MaxPixelsPerSide,
    long MaxTotalPixels,
    int MaxOutputSide,
    int JpegQuality,
    bool ForceJpeg);

/// <summary>A picture after processing: the bytes the server will store, never the sender's file.</summary>
public sealed record ProcessedImage(byte[] Data, string ContentType, string Extension, int Width, int Height);

/// <summary>
/// The one place an uploaded picture is checked and cleaned, for every upload in the app. The type is decided from the
/// file's first bytes (never the name or the declared type), the size is read from the header before decoding, and the
/// picture is decoded and written out again, so metadata (such as GPS) and anything hidden in the original file are gone
/// and what is stored is ours, not the sender's. The extension of what is stored comes from what it really is.
/// </summary>
public static class ImageSanitizer
{
    public const string NotAnImageMessage = "That file is not a picture we accept. Please send a JPEG, PNG or WebP photo.";

    public static ProcessedImage Process(byte[] data, ImageRules rules)
    {
        if (data is null || data.Length == 0)
        {
            throw new ImageRejectedException("The picture is empty.");
        }

        if (data.Length > rules.MaxBytes)
        {
            throw new ImageRejectedException(
                $"The picture is too big. The limit is {rules.MaxBytes / (1024 * 1024)} MB.", suspicious: true);
        }

        if (!HasAllowedSignature(data))
        {
            throw new ImageRejectedException(NotAnImageMessage, suspicious: true);
        }

        try
        {
            using var codec = SKCodec.Create(new MemoryStream(data, writable: false));
            if (codec == null || codec.EncodedFormat is not (SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Png or SKEncodedImageFormat.Webp))
            {
                throw new ImageRejectedException(NotAnImageMessage, suspicious: true);
            }

            // The size is read from the header, so a small file that unpacks into a huge picture is stopped before decoding.
            var width = codec.Info.Width;
            var height = codec.Info.Height;
            if (width <= 0 || height <= 0
                || width > rules.MaxPixelsPerSide || height > rules.MaxPixelsPerSide
                || (long)width * height > rules.MaxTotalPixels)
            {
                throw new ImageRejectedException(
                    $"The picture is too large. The limit is {rules.MaxPixelsPerSide} x {rules.MaxPixelsPerSide} pixels.",
                    suspicious: true);
            }

            using var decoded = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
            if (codec.GetPixels(decoded.Info, decoded.GetPixels()) != SKCodecResult.Success)
            {
                throw new ImageRejectedException("The picture is damaged or cannot be read.", suspicious: true);
            }

            // Turn it upright the way the camera meant (the orientation tag), then shrink it if it is big.
            var origin = codec.EncodedOrigin;
            var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
                or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
            var uprightWidth = swap ? height : width;
            var uprightHeight = swap ? width : height;
            var scale = Math.Min(1d, (double)rules.MaxOutputSide / Math.Max(uprightWidth, uprightHeight));
            var outWidth = Math.Max(1, (int)Math.Round(uprightWidth * scale));
            var outHeight = Math.Max(1, (int)Math.Round(uprightHeight * scale));

            var format = rules.ForceJpeg ? SKEncodedImageFormat.Jpeg : codec.EncodedFormat;
            using var surface = SKSurface.Create(new SKImageInfo(outWidth, outHeight, SKColorType.Rgba8888, SKAlphaType.Premul));
            var canvas = surface.Canvas;

            // A JPEG cannot be see-through, so it goes on white. PNG and WebP keep their transparency.
            canvas.Clear(format == SKEncodedImageFormat.Jpeg ? SKColors.White : SKColors.Transparent);
            canvas.Scale((float)scale);
            canvas.Concat(UprightMatrix(origin, width, height));
            canvas.DrawBitmap(decoded, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));

            // Writing a fresh file carries over no metadata (no GPS, camera or software tags) and nothing hidden in the original.
            using var image = surface.Snapshot();
            using var encoded = image.Encode(format, rules.JpegQuality);
            if (encoded == null)
            {
                throw new ImageRejectedException("The picture is damaged or cannot be read.", suspicious: true);
            }

            var (contentType, extension) = format switch
            {
                SKEncodedImageFormat.Png => ("image/png", ".png"),
                SKEncodedImageFormat.Webp => ("image/webp", ".webp"),
                _ => ("image/jpeg", ".jpg")
            };
            return new ProcessedImage(encoded.ToArray(), contentType, extension, outWidth, outHeight);
        }
        catch (ImageRejectedException)
        {
            throw;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            throw new ImageRejectedException("The picture is damaged or cannot be read.", suspicious: true);
        }
    }

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
}

/// <summary>
/// The rules for the pictures staff and the app itself upload: a product, a customer, a user's profile or a promotion.
/// One set of rules for all of them. The picture keeps its own format (so a transparent PNG logo stays transparent), is
/// limited to 5 MB and about 25 megapixels, and is shrunk to 2048 px if bigger.
/// </summary>
public static class ImageUploads
{
    public static readonly ImageRules Rules = new(
        MaxBytes: 5 * 1024 * 1024,
        MaxPixelsPerSide: 8000,
        MaxTotalPixels: 25_000_000,
        MaxOutputSide: 2048,
        JpegQuality: 88,
        ForceJpeg: false);

    /// <summary>Checks and cleans an upload. Throws <see cref="ImageRejectedException"/> (answered as a 400 with its message).</summary>
    public static ProcessedImage Prepare(byte[]? data) => ImageSanitizer.Process(data!, Rules);

    /// <summary>
    /// Reads an upload into memory, refusing an empty or oversized one before any of it is read. The endpoints of every
    /// picture upload use this, so the limit is the same everywhere.
    /// </summary>
    public static async Task<byte[]> ReadAsync(IFormFile? file, int maxBytes = 0)
    {
        var limit = maxBytes > 0 ? maxBytes : Rules.MaxBytes;
        if (file == null || file.Length == 0)
        {
            throw new ImageRejectedException("No file uploaded.");
        }

        if (file.Length > limit)
        {
            throw new ImageRejectedException($"The picture is too big. The limit is {limit / (1024 * 1024)} MB.");
        }

        using var stream = new MemoryStream((int)file.Length);
        await file.CopyToAsync(stream);
        return stream.ToArray();
    }

    /// <summary>A little over the picture limit, for the form's own overhead.</summary>
    public const long RequestLimit = 6 * 1024 * 1024;
}
