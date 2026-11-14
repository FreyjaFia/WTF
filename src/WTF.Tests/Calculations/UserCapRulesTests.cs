using WTF.Calculations.Subscriptions;

namespace WTF.Tests.Calculations;

public class UserCapRulesTests
{
    [Theory]
    [InlineData(0, 3, true)]
    [InlineData(2, 3, true)]
    [InlineData(3, 3, false)]
    [InlineData(5, 3, false)]
    [InlineData(500, null, true)]
    public void CanAddUser_IsTrueOnlyBelowTheCap(int active, int? cap, bool expected)
    {
        UserCapRules.CanAddUser(active, cap).ShouldBe(expected);
    }

    [Theory]
    [InlineData(2, 3, 0)]
    [InlineData(3, 3, 0)]
    [InlineData(5, 3, 2)]
    [InlineData(5, null, 0)]
    public void UsersOverCap_IsHowManyAreAboveTheCap(int active, int? cap, int expected)
    {
        UserCapRules.UsersOverCap(active, cap).ShouldBe(expected);
    }
}
