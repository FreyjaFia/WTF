using WTF.Api.Features.Items;

namespace WTF.Tests.Features.Items;

public class ItemValidationTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("  SKU-1  ", "SKU-1")]
    [InlineData("abc", "abc")]
    public void NormalizeOptional_TrimsAndNullsBlank(string? input, string? expected)
    {
        ItemValidation.NormalizeOptional(input).ShouldBe(expected);
    }
}
