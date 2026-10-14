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
    [InlineData("Ana", " ")]
    [InlineData(null, "Cruz")]
    [InlineData("Ana", null)]
    public void EnsureValidNames_MissingEither_Throws(string? first, string? last)
    {
        Should.Throw<InvalidOperationException>(() => CustomerValidation.EnsureValidNames(first!, last!))
            .Message.ShouldBe("Customer first name and last name are required.");
    }
}
