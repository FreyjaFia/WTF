using Microsoft.AspNetCore.Http;
using NSubstitute;
using SkiaSharp;
using WTF.Api.Services;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Services;

/// <summary>The one engine behind every picture upload: the staff uploads (ImageUploads) and the chat (via ChatImageProcessor).</summary>
public class ImageSanitizerTests
{
    private static readonly ImageRules Chat = new(5 * 1024 * 1024, 4096, 4096L * 4096, 1600, 82, ForceJpeg: true);

    private static ProcessedImage Prepare(byte[] data) => ImageUploads.Prepare(data);

    private static ImageRejectedException Refused(byte[] data, ImageRules? rules = null) =>
        Should.Throw<ImageRejectedException>(() => ImageSanitizer.Process(data, rules ?? ImageUploads.Rules));

    // ===== the staff upload rules: keep the picture's own type =====

    [Theory]
    [InlineData("jpeg", ".jpg", "image/jpeg")]
    [InlineData("png", ".png", "image/png")]
    [InlineData("webp", ".webp", "image/webp")]
    public void KeepsTheOwnTypeAndNamesItFromWhatItReallyIs(string kind, string extension, string contentType)
    {
        var data = kind switch { "png" => TestImages.Png(), "webp" => TestImages.Webp(), _ => TestImages.Jpeg() };

        var result = Prepare(data);

        result.Extension.ShouldBe(extension);
        result.ContentType.ShouldBe(contentType);
        TestImages.FormatOf(result.Data).ShouldBe(kind switch
        {
            "png" => SKEncodedImageFormat.Png,
            "webp" => SKEncodedImageFormat.Webp,
            _ => SKEncodedImageFormat.Jpeg
        });
        result.Width.ShouldBe(40);
        result.Height.ShouldBe(30);
    }

    [Fact]
    public void ATransparentPngStaysTransparent()
    {
        var result = Prepare(TestImages.Png(10, 10, SKColors.Transparent));

        using var decoded = SKBitmap.Decode(result.Data);
        decoded.GetPixel(5, 5).Alpha.ShouldBe((byte)0);
    }

    [Fact]
    public void ATransparentPngBecomesWhiteOnlyWhenTheRulesAskForAJpeg()
    {
        var result = ImageSanitizer.Process(TestImages.Png(10, 10, SKColors.Transparent), Chat);

        result.ContentType.ShouldBe("image/jpeg");
        using var decoded = SKBitmap.Decode(result.Data);
        decoded.GetPixel(5, 5).Red.ShouldBeGreaterThan((byte)240);
    }

    [Fact]
    public void ABigPictureIsShrunkToTheStoredSize_AndASmallOneIsNeverScaledUp()
    {
        var big = Prepare(TestImages.Jpeg(4000, 3000));
        var small = Prepare(TestImages.Jpeg(100, 80));

        big.Width.ShouldBe(2048);
        big.Height.ShouldBe(1536);
        small.Width.ShouldBe(100);
        small.Height.ShouldBe(80);
    }

    [Fact]
    public void ThePictureComesOutAsOurOwnFile_NothingHiddenAfterItSurvives()
    {
        var original = TestImages.Png().Concat("HIDDEN-PAYLOAD-123"u8.ToArray()).ToArray();
        System.Text.Encoding.Latin1.GetString(original).ShouldContain("HIDDEN-PAYLOAD-123");

        var result = Prepare(original);

        System.Text.Encoding.Latin1.GetString(result.Data).ShouldNotContain("HIDDEN-PAYLOAD-123");
        TestImages.FormatOf(result.Data).ShouldBe(SKEncodedImageFormat.Png);
    }

    // ===== what is refused =====

    [Fact]
    public void AScriptNamedLikeAPictureIsRefused_AndFlaggedAsSuspicious()
    {
        var error = Refused(TestImages.Script());

        error.Message.ShouldBe(ImageSanitizer.NotAnImageMessage);
        error.Suspicious.ShouldBeTrue();
    }

    [Theory]
    [InlineData("svg")]
    [InlineData("gif")]
    [InlineData("exe")]
    [InlineData("pdf")]
    public void OtherFileTypesAreRefused(string kind)
    {
        var data = kind switch
        {
            "svg" => "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>x</script></svg>"u8.ToArray(),
            "gif" => "GIF89a\x01\0\x01\0\0\0\0;"u8.ToArray(),
            "pdf" => "%PDF-1.4 1 0 obj"u8.ToArray(),
            _ => [(byte)'M', (byte)'Z', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        };

        Refused(data).Message.ShouldBe(ImageSanitizer.NotAnImageMessage);
    }

    [Fact]
    public void AnEmptyUploadIsRefused()
    {
        Refused([]).Message.ShouldContain("empty");
    }

    [Fact]
    public void AnUploadOverTheSizeLimitIsRefusedBeforeAnythingIsDecoded()
    {
        Refused(TestImages.OverTheLimit()).Message.ShouldContain("too big");
    }

    [Fact]
    public void APictureWithTooManyPixelsIsRefusedWithoutBeingDecoded()
    {
        var rules = ImageUploads.Rules with { MaxPixelsPerSide = 100, MaxTotalPixels = 5000 };

        Refused(TestImages.Png(101, 10), rules).Message.ShouldContain("too large");
        Refused(TestImages.Png(90, 90), rules).Message.ShouldContain("too large");
        ImageSanitizer.Process(TestImages.Png(70, 70), rules).Width.ShouldBe(70);
    }

    [Fact]
    public void ACorruptPictureIsRefused()
    {
        var corrupt = TestImages.Png(200, 200);
        for (var i = 60; i < corrupt.Length - 20; i++)
        {
            corrupt[i] = 0x13;
        }

        Refused(corrupt).Suspicious.ShouldBeTrue();
    }

    [Fact]
    public void AnExecutableBehindAPictureHeaderIsRefused()
    {
        var data = new byte[4096];
        data[0] = 0xFF;
        data[1] = 0xD8;
        data[2] = 0xFF;
        new Random(1).NextBytes(data.AsSpan(3));

        Refused(data).Suspicious.ShouldBeTrue();
    }

    // ===== reading the upload =====

    private static IFormFile Upload(long length, byte[]? data = null)
    {
        var file = Substitute.For<IFormFile>();
        file.Length.Returns(length);
        file.CopyToAsync(Arg.Any<Stream>(), Arg.Any<CancellationToken>()).Returns(async ci =>
        {
            var bytes = data ?? new byte[length];
            await ((Stream)ci[0]).WriteAsync(bytes);
        });
        return file;
    }

    [Fact]
    public async Task NoFileOrAnEmptyFile_IsRefused()
    {
        await Should.ThrowAsync<ImageRejectedException>(() => ImageUploads.ReadAsync(null));
        await Should.ThrowAsync<ImageRejectedException>(() => ImageUploads.ReadAsync(Upload(0)));
    }

    [Fact]
    public async Task AFileOverTheLimit_IsRefusedBeforeItIsRead()
    {
        var file = Upload(ImageUploads.Rules.MaxBytes + 1L);

        var error = await Should.ThrowAsync<ImageRejectedException>(() => ImageUploads.ReadAsync(file));

        error.Message.ShouldContain("too big");
        await file.DidNotReceiveWithAnyArgs().CopyToAsync(default!, default);
    }

    [Fact]
    public async Task AFileWithinTheLimit_IsReadWhole()
    {
        var png = TestImages.Png();

        var data = await ImageUploads.ReadAsync(Upload(png.Length, png));

        data.ShouldBe(png);
    }

    [Fact]
    public async Task ALowerLimitCanBeGiven_ForAnUploadThatNeedsOne()
    {
        var png = TestImages.Png();

        await Should.ThrowAsync<ImageRejectedException>(() => ImageUploads.ReadAsync(Upload(2 * 1024 * 1024), maxBytes: 1024 * 1024));
        (await ImageUploads.ReadAsync(Upload(png.Length, png), maxBytes: 1024 * 1024)).ShouldBe(png);
    }

    [Fact]
    public void TheRulesAreTheAgreedOnes()
    {
        ImageUploads.Rules.MaxBytes.ShouldBe(5 * 1024 * 1024);
        ImageUploads.Rules.ForceJpeg.ShouldBeFalse();
        ImageUploads.Rules.MaxOutputSide.ShouldBe(2048);
        ImageUploads.RequestLimit.ShouldBeGreaterThan(ImageUploads.Rules.MaxBytes);
    }
}
