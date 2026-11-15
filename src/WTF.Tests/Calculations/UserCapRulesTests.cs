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

    [Fact]
    public void BlockedUserIds_BlocksTheNewestUsersPastTheCap()
    {
        var owner = Seat(true, 0);
        var a = Seat(false, 1);
        var b = Seat(false, 2);
        var c = Seat(false, 3);

        var blocked = UserCapRules.BlockedUserIds([c, b, owner, a], 2);

        blocked.ShouldBe([b.Id, c.Id], ignoreOrder: true);
    }

    [Fact]
    public void BlockedUserIds_NeverBlocksAnOwnerEvenWhenNewest()
    {
        var oldCashier = Seat(false, 0);
        var newOwner = Seat(true, 9);

        UserCapRules.BlockedUserIds([oldCashier, newOwner], 1).ShouldBe([oldCashier.Id]);
        UserCapRules.BlockedUserIds([oldCashier, newOwner], 0).ShouldBe([oldCashier.Id]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(3)]
    [InlineData(10)]
    public void BlockedUserIds_IsEmptyWhenUnderTheCapOrUnlimited(int? cap)
    {
        UserCapRules.BlockedUserIds([Seat(true, 0), Seat(false, 1), Seat(false, 2)], cap).ShouldBeEmpty();
    }

    private static SeatCandidate Seat(bool owner, int day) => new(Guid.NewGuid(), owner, new DateTime(2026, 1, 1).AddDays(day));
}
