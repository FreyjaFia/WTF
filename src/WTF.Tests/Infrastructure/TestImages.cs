using SkiaSharp;

namespace WTF.Tests.Infrastructure;

internal static class TestImages
{
    public static byte[] Png(int width = 40, int height = 30, SKColor? colour = null) =>
        Make(SKEncodedImageFormat.Png, width, height, colour);

    public static byte[] Jpeg(int width = 40, int height = 30, SKColor? colour = null) =>
        Make(SKEncodedImageFormat.Jpeg, width, height, colour);

    public static byte[] Webp(int width = 40, int height = 30, SKColor? colour = null) =>
        Make(SKEncodedImageFormat.Webp, width, height, colour);

    public static byte[] Script() => "<script>alert(1)</script>"u8.ToArray();

    public static byte[] OverTheLimit() => new byte[(5 * 1024 * 1024) + 1];

    public static SKEncodedImageFormat FormatOf(byte[] data)
    {
        using var codec = SKCodec.Create(new MemoryStream(data));
        return codec.EncodedFormat;
    }

    private static byte[] Make(SKEncodedImageFormat format, int width, int height, SKColor? colour)
    {
        using var bitmap = new SKBitmap(width, height);
        bitmap.Erase(colour ?? new SKColor(200, 30, 30, 255));
        using var image = SKImage.FromBitmap(bitmap);
        return image.Encode(format, 90).ToArray();
    }
}
