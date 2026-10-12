using WTF.Api.Services;

namespace WTF.Tests.Services;

public class ImageKeyTests
{
    [Theory]
    [InlineData("/images/products/a.png", "images/products/a.png")]
    [InlineData("images/products/a.png", "images/products/a.png")]
    [InlineData("\\images\\products\\a.png", "images/products/a.png")]
    [InlineData("/images//products/a.png", "images/products/a.png")]
    [InlineData("https://acct.blob.core.windows.net/wtf-images/images/products/a.png", "images/products/a.png")]
    [InlineData("https://acct.blob.core.windows.net/wtf-images/images/products/caf%C3%A9_1.png", "images/products/café_1.png")]
    [InlineData("https://acct.blob.core.windows.net/wtf-images/images/products/ice%20tea_1.png", "images/products/ice tea_1.png")]
    [InlineData("https://acct.blob.core.windows.net/wtf-images/images/products/a%23b_1.png", "images/products/a#b_1.png")]
    [InlineData("https://wtfbyfaith.runasp.net/images/users/u.png", "images/users/u.png")]
    [InlineData("/proxy/images/users/u.png", "images/users/u.png")]
    public void From_NormalisesEveryShape(string url, string expected)
    {
        ImageKey.From(url, "wtf-images").ShouldBe(expected);
    }

    [Fact]
    public void From_DatabaseUrlAndListedBlobName_Match()
    {
        var saved = "https://acct.blob.core.windows.net/wtf-images/images/products/caf%C3%A9_au_lait_1.png";
        var listed = "images/products/café_au_lait_1.png";

        ImageKey.From(saved, "wtf-images").ShouldBe(ImageKey.From(listed, "wtf-images"));
    }

    [Fact]
    public void From_EmptyOrMalformed_DoesNotThrow()
    {
        ImageKey.From(null).ShouldBe(string.Empty);
        ImageKey.From("  ").ShouldBe(string.Empty);
        Should.NotThrow(() => ImageKey.From("/images/a%ZZ.png"));
    }

    [Fact]
    public void FileName_IsLowerCaseLastSegment()
    {
        ImageKey.FileName("https://x/c/images/products/Latte_ABC.PNG").ShouldBe("latte_abc.png");
    }
}
