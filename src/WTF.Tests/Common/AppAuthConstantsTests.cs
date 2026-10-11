using WTF.Api.Common.Auth;

namespace WTF.Tests.Common;

public class AppAuthConstantsTests
{
    private static List<string> Constants(Type type) =>
        type.GetFields().Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!).ToList();

    [Theory]
    [InlineData(typeof(AppRoles))]
    [InlineData(typeof(AppPolicies))]
    public void Constants_AreUniqueAndNonEmpty(Type type)
    {
        var values = Constants(type);

        values.ShouldNotBeEmpty();
        values.ShouldAllBe(v => !string.IsNullOrWhiteSpace(v));
        values.Distinct().Count().ShouldBe(values.Count);
    }

    [Theory]
    [InlineData(typeof(AppRoles))]
    [InlineData(typeof(AppPolicies))]
    public void Constants_ValueMatchesFieldName(Type type)
    {
        foreach (var field in type.GetFields().Where(f => f.IsLiteral))
        {
            field.GetRawConstantValue().ShouldBe(field.Name);
        }
    }
}
