using WTF.Api.Common.Auth;
using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Common;

public class AppPoliciesTests
{
    [Fact]
    public void RequireFeature_ForACatalogKey_AddsThePrefix()
    {
        AppPolicies.RequireFeature(PlanFeatures.Inventory).ShouldBe("Feature:inventory");
    }

    [Theory]
    [InlineData("inventroy")]
    [InlineData("core")]
    [InlineData("")]
    public void RequireFeature_ForAKeyOutsideTheCatalog_Throws(string feature)
    {
        Should.Throw<ArgumentException>(() => AppPolicies.RequireFeature(feature));
    }

    [Fact]
    public void PlanFeatureConstants_CoverTheWholeCatalog()
    {
        var constants = typeof(PlanFeatures).GetFields()
            .Where(f => f.IsLiteral && f.Name != nameof(PlanFeatures.Core))
            .Select(f => (string)f.GetRawConstantValue()!)
            .Order()
            .ToList();

        constants.ShouldBe(PlanFeatures.Gateable.Order().ToList());
    }
}
