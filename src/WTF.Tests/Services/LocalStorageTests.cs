using Microsoft.AspNetCore.Hosting;
using NSubstitute;
using WTF.Api.Services;

namespace WTF.Tests.Services;

public sealed class LocalStorageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "wtf-tests-" + Guid.NewGuid().ToString("N"));
    private readonly IWebHostEnvironment _env = Substitute.For<IWebHostEnvironment>();

    public LocalStorageTests()
    {
        Directory.CreateDirectory(_root);
        _env.WebRootPath.Returns(_root);
        _env.ContentRootPath.Returns(_root);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    // ---- LocalImageStorage ----

    [Fact]
    public async Task ImageSave_WritesFileAndReturnsUrl()
    {
        var sut = new LocalImageStorage(_env);

        var url = await sut.SaveAsync("products", "a.png", [1, 2, 3], CancellationToken.None);

        url.ShouldBe("/images/products/a.png");
        File.ReadAllBytes(Path.Combine(_root, "images", "products", "a.png")).ShouldBe(new byte[] { 1, 2, 3 });
    }

    [Fact]
    public async Task ImageDelete_RelativeUrl_RemovesFile()
    {
        var sut = new LocalImageStorage(_env);
        var url = await sut.SaveAsync("users", "u.png", [9], CancellationToken.None);

        await sut.DeleteAsync(url, CancellationToken.None);

        File.Exists(Path.Combine(_root, "images", "users", "u.png")).ShouldBeFalse();
    }

    [Fact]
    public async Task ImageDelete_AbsoluteUrl_RemovesFile()
    {
        var sut = new LocalImageStorage(_env);
        await sut.SaveAsync("users", "abs.png", [9], CancellationToken.None);

        await sut.DeleteAsync("https://example.com/images/users/abs.png", CancellationToken.None);

        File.Exists(Path.Combine(_root, "images", "users", "abs.png")).ShouldBeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ImageDelete_BlankUrl_DoesNothing(string? url)
    {
        var sut = new LocalImageStorage(_env);

        await Should.NotThrowAsync(() => sut.DeleteAsync(url, CancellationToken.None));
    }

    [Fact]
    public async Task ImageDelete_OutsideImagesFolder_IsIgnored()
    {
        var outside = Path.Combine(_root, "keep.txt");
        File.WriteAllText(outside, "x");
        var sut = new LocalImageStorage(_env);

        await sut.DeleteAsync("/keep.txt", CancellationToken.None);

        File.Exists(outside).ShouldBeTrue();
    }

    [Fact]
    public async Task ImageDelete_MissingFile_DoesNotThrow()
    {
        var sut = new LocalImageStorage(_env);

        await Should.NotThrowAsync(() => sut.DeleteAsync("/images/x/missing.png", CancellationToken.None));
    }

    [Fact]
    public async Task ImageSave_BlankWebRoot_FallsBackToContentRootWwwroot()
    {
        var env = Substitute.For<IWebHostEnvironment>();
        env.WebRootPath.Returns("");
        env.ContentRootPath.Returns(_root);
        var sut = new LocalImageStorage(env);

        await sut.SaveAsync("c", "f.png", [1], CancellationToken.None);

        File.Exists(Path.Combine(_root, "wwwroot", "images", "c", "f.png")).ShouldBeTrue();
    }

    // ---- LocalReportFileStorage ----

    [Fact]
    public async Task ReportSave_ThenRead_RoundTrips()
    {
        var sut = new LocalReportFileStorage(_env);

        await sut.SaveAsync("reports/2025/jan.xlsx", [5, 6], "application/x", null, CancellationToken.None);

        (await sut.ReadAllBytesAsync("reports/2025/jan.xlsx", CancellationToken.None)).ShouldBe(new byte[] { 5, 6 });
    }

    [Fact]
    public async Task ReportSave_SetsLastWriteTimeFromGeneratedAt()
    {
        var sut = new LocalReportFileStorage(_env);
        var generated = new DateTimeOffset(2025, 1, 15, 10, 30, 0, TimeSpan.Zero);

        await sut.SaveAsync("r/a.xlsx", [1, 2, 3, 4], "x", generated, CancellationToken.None);
        var info = await sut.GetInfoAsync("r/a.xlsx", CancellationToken.None);

        info.ShouldNotBeNull();
        info.RelativePath.ShouldBe("r/a.xlsx");
        info.SizeBytes.ShouldBe(4);
        info.LastModifiedUtc.ShouldBe(generated);
    }

    [Fact]
    public async Task ReportRead_Missing_ReturnsNull()
    {
        var sut = new LocalReportFileStorage(_env);

        (await sut.ReadAllBytesAsync("nope.xlsx", CancellationToken.None)).ShouldBeNull();
        (await sut.GetInfoAsync("nope.xlsx", CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task ReportPath_BackslashesAndLeadingSlash_AreNormalized()
    {
        var sut = new LocalReportFileStorage(_env);

        await sut.SaveAsync("\\sub\\f.bin", [1], "x", null, CancellationToken.None);
        var info = await sut.GetInfoAsync("/sub/f.bin", CancellationToken.None);

        info.ShouldNotBeNull();
        info.RelativePath.ShouldBe("sub/f.bin");
    }

    [Theory]
    [InlineData("../evil.txt")]
    [InlineData("a/../../evil.txt")]
    [InlineData("..\\evil.txt")]
    public async Task ReportPath_Traversal_Throws(string path)
    {
        var sut = new LocalReportFileStorage(_env);

        (await Should.ThrowAsync<InvalidOperationException>(
            () => sut.SaveAsync(path, [1], "x", null, CancellationToken.None)))
            .Message.ShouldBe("Invalid report file path.");
        await Should.ThrowAsync<InvalidOperationException>(() => sut.ReadAllBytesAsync(path, CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => sut.GetInfoAsync(path, CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task ReportPath_Blank_Throws(string path)
    {
        var sut = new LocalReportFileStorage(_env);

        (await Should.ThrowAsync<InvalidOperationException>(
            () => sut.SaveAsync(path, [1], "x", null, CancellationToken.None)))
            .Message.ShouldBe("Report file path is required.");
    }

    [Fact]
    public async Task ReportSave_NullData_Throws()
    {
        var sut = new LocalReportFileStorage(_env);

        await Should.ThrowAsync<ArgumentNullException>(
            () => sut.SaveAsync("a.bin", null!, "x", null, CancellationToken.None));
    }
}
