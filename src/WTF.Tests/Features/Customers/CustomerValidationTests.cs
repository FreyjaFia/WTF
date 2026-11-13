using WTF.Api.Features.Customers;

namespace WTF.Tests.Features.Customers;

public class CustomerValidationTests
{
    [Fact]
    public void EnsureValidNames_BothPresent_DoesNotThrow()
    {
        Should.NotThrow(() => CustomerValidation.EnsureValidNames("Ana", "Cruz"));
    }

    [Theory]
    [InlineData("", "Cruz")]
    [InlineData(" ", null)]
    [InlineData(null, "Cruz")]
    public void EnsureValidNames_MissingFirstName_Throws(string? first, string? last)
    {
        Should.Throw<InvalidOperationException>(() => CustomerValidation.EnsureValidNames(first!, last))
            .Message.ShouldBe("Customer first name is required.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void EnsureValidNames_BlankLastName_IsAllowed(string? last)
    {
        Should.NotThrow(() => CustomerValidation.EnsureValidNames("Ana", last));
    }

    [Fact]
    public void EnsureValidNames_NameOverFiftyCharacters_Throws()
    {
        Should.Throw<InvalidOperationException>(() => CustomerValidation.EnsureValidNames("Ana", new string('x', 51)));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("  5 Side St  ", "5 Side St")]
    public void NormalizeAddress_TrimsAndTurnsBlankIntoNull(string? input, string? expected)
    {
        CustomerValidation.NormalizeAddress(input).ShouldBe(expected);
    }

    [Fact]
    public void NormalizeAddress_OneHundredFiftyCharactersIsFine_OneHundredFiftyOneIsRefused()
    {
        CustomerValidation.NormalizeAddress(new string('a', 150)).ShouldBe(new string('a', 150));
        Should.Throw<InvalidOperationException>(() => CustomerValidation.NormalizeAddress(new string('a', 151)));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("  ", null)]
    [InlineData(" Cruz ", "Cruz")]
    public void NormalizeLastName_BlankBecomesNull(string? input, string? expected)
    {
        CustomerValidation.NormalizeLastName(input).ShouldBe(expected);
    }

    [Theory]
    [InlineData("Ana", "Cruz", "Ana Cruz")]
    [InlineData("Ana", null, "Ana")]
    [InlineData("Ana", " ", "Ana")]
    public void CustomerName_Join_NeverPrintsNullOrTrailingSpaces(string first, string? last, string expected)
    {
        CustomerName.Join(first, last).ShouldBe(expected);
    }
}
