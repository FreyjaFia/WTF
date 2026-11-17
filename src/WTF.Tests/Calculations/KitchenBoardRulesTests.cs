using WTF.Calculations.Kitchen;
using WTF.Calculations.Sales;

namespace WTF.Tests.Calculations;

public class KitchenBoardRulesTests
{
    private static readonly TimeZoneInfo Manila = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    private static KitchenLine Line(string key, int quantity, string? label = null) => new(key, label ?? key, quantity);

    [Theory]
    [InlineData(OrderStatuses.Pending, 0, true)]
    [InlineData(OrderStatuses.Pending, 1, true)]
    [InlineData(OrderStatuses.Pending, 2, true)]
    [InlineData(OrderStatuses.Pending, 3, false)]
    [InlineData(OrderStatuses.Completed, 0, true)]
    [InlineData(OrderStatuses.Completed, 3, false)]
    [InlineData(OrderStatuses.PendingApproval, 0, false)]
    [InlineData(OrderStatuses.PendingReview, 0, false)]
    [InlineData(OrderStatuses.Cancelled, 1, false)]
    public void IsOnBoard_NeedsAPendingOrderThatIsNotServed(int statusId, byte kitchen, bool expected)
    {
        KitchenBoardRules.IsOnBoard(statusId, kitchen).ShouldBe(expected);
    }

    [Fact]
    public void IsOnBoard_NeverShowsAnOrderThatIsNotTracked()
    {
        KitchenBoardRules.IsOnBoard(OrderStatuses.Pending, null).ShouldBeFalse();
    }

    [Fact]
    public void IsOnBoard_KeepsAPrepaidOrderUntilItIsServed()
    {
        KitchenBoardRules.IsOnBoard(OrderStatuses.Completed, (byte)KitchenState.Preparing).ShouldBeTrue();
        KitchenBoardRules.IsOnBoard(OrderStatuses.Completed, (byte)KitchenState.Served).ShouldBeFalse();
    }

    [Theory]
    [InlineData(OrderStatuses.Cancelled, 0, false, false)]
    [InlineData(OrderStatuses.Cancelled, 1, false, true)]
    [InlineData(OrderStatuses.Cancelled, 2, false, true)]
    [InlineData(OrderStatuses.Refunded, 1, false, true)]
    [InlineData(OrderStatuses.Cancelled, 1, true, false)]
    [InlineData(OrderStatuses.Cancelled, 3, false, false)]
    [InlineData(OrderStatuses.Pending, 1, false, false)]
    public void IsStopMakingCard_OnlyForStartedOrdersThatWereCancelled(int statusId, byte kitchen, bool dismissed, bool expected)
    {
        KitchenBoardRules.IsStopMakingCard(statusId, kitchen, dismissed).ShouldBe(expected);
    }

    [Fact]
    public void IsStopMakingCard_NeverShowsAnOrderThatIsNotTracked()
    {
        KitchenBoardRules.IsStopMakingCard(OrderStatuses.Cancelled, null, false).ShouldBeFalse();
    }

    [Fact]
    public void IsStale_UsesTheShopsLocalDay()
    {
        // 23:30 in Manila on 10 Nov is 15:30 UTC; 00:10 on 11 Nov in Manila is 16:10 UTC the day before.
        var created = new DateTime(2026, 11, 10, 15, 30, 0, DateTimeKind.Utc);

        KitchenBoardRules.IsStale(created, new DateTime(2026, 11, 10, 15, 59, 0, DateTimeKind.Utc), Manila).ShouldBeFalse();
        KitchenBoardRules.IsStale(created, new DateTime(2026, 11, 10, 16, 1, 0, DateTimeKind.Utc), Manila).ShouldBeTrue();
    }

    [Theory]
    [InlineData(KitchenState.New, KitchenState.Preparing, KitchenMove.Moved)]
    [InlineData(KitchenState.New, KitchenState.Ready, KitchenMove.Moved)]
    [InlineData(KitchenState.New, KitchenState.Served, KitchenMove.Moved)]
    [InlineData(KitchenState.Preparing, KitchenState.Served, KitchenMove.Moved)]
    [InlineData(KitchenState.Ready, KitchenState.Preparing, KitchenMove.Moved)]
    [InlineData(KitchenState.Preparing, KitchenState.New, KitchenMove.Moved)]
    [InlineData(KitchenState.Ready, KitchenState.New, KitchenMove.Refused)]
    [InlineData(KitchenState.Preparing, KitchenState.Preparing, KitchenMove.AlreadyThere)]
    [InlineData(KitchenState.Served, KitchenState.Served, KitchenMove.AlreadyThere)]
    [InlineData(KitchenState.Served, KitchenState.Ready, KitchenMove.Refused)]
    [InlineData(KitchenState.Served, KitchenState.New, KitchenMove.Refused)]
    public void Decide_AllowsSkippingForwardAndOneStepBack(KitchenState from, KitchenState to, KitchenMove expected)
    {
        KitchenBoardRules.Decide(from, to).ShouldBe(expected);
    }

    [Fact]
    public void Decide_BringsAServedOrderBackToReadyOnlyWhenAskedTo()
    {
        KitchenBoardRules.Decide(KitchenState.Served, KitchenState.Ready, bringBack: true).ShouldBe(KitchenMove.Moved);
        KitchenBoardRules.Decide(KitchenState.Served, KitchenState.Preparing, bringBack: true).ShouldBe(KitchenMove.Refused);
    }

    [Theory]
    [InlineData(KitchenState.Ready, KitchenState.Ready, KitchenMove.AlreadyThere)]
    [InlineData(KitchenState.Served, KitchenState.Ready, KitchenMove.AlreadyThere)]
    [InlineData(KitchenState.New, KitchenState.Ready, KitchenMove.Moved)]
    public void DecideForward_IsHarmlessWhenTwoTabletsTapTogether(KitchenState current, KitchenState wanted, KitchenMove expected)
    {
        KitchenBoardRules.DecideForward(current, wanted).ShouldBe(expected);
    }

    [Fact]
    public void Diff_SumsLinesOfTheSameKeyAndIgnoresOrder()
    {
        var before = new[] { Line("latte-iced", 2), Line("mocha", 1) };
        var after = new[] { Line("mocha", 1), Line("latte-iced", 1), Line("latte-iced", 1) };

        var diff = KitchenBoardRules.Diff(before, after);

        diff.HasAdded.ShouldBeFalse();
        diff.HasRemoved.ShouldBeFalse();
        diff.Note.ShouldBe("");
    }

    [Fact]
    public void Diff_NamesWhatWasAddedAndRemoved()
    {
        var before = new[] { Line("latte-hot", 1, "1x Latte (Hot)"), Line("mocha", 1, "Mocha") };
        var after = new[] { Line("latte-iced", 1, "Latte (Iced)"), Line("mocha", 1, "Mocha"), Line("brownie", 2, "Brownie") };

        var diff = KitchenBoardRules.Diff(before, after);

        diff.HasAdded.ShouldBeTrue();
        diff.HasRemoved.ShouldBeTrue();
        diff.Note.ShouldBe("+2 Brownie, +1 Latte (Iced), -1 1x Latte (Hot)");
    }

    [Fact]
    public void Diff_CutsALongNote()
    {
        var after = Enumerable.Range(0, 60).Select(i => Line("k" + i, 1, "Very long product name " + i)).ToList();

        var diff = KitchenBoardRules.Diff([], after);

        diff.Note.Length.ShouldBe(KitchenBoardRules.NoteMaxLength);
        diff.Note.ShouldEndWith("…");
    }

    [Fact]
    public void Diff_OnlyAQuantityChangeCountsAsAddedOrRemoved()
    {
        var diff = KitchenBoardRules.Diff([Line("latte", 3)], [Line("latte", 2)]);

        diff.HasRemoved.ShouldBeTrue();
        diff.HasAdded.ShouldBeFalse();
        diff.Note.ShouldBe("-1 latte");
    }

    [Theory]
    [InlineData(KitchenState.New, false, true, null, KitchenChangeKind.Changed)]
    [InlineData(KitchenState.Preparing, false, true, null, KitchenChangeKind.Changed)]
    [InlineData(KitchenState.Ready, false, true, KitchenState.Preparing, KitchenChangeKind.Changed)]
    [InlineData(KitchenState.Served, false, true, null, KitchenChangeKind.None)]
    [InlineData(KitchenState.New, true, false, null, KitchenChangeKind.Added)]
    [InlineData(KitchenState.Preparing, true, false, null, KitchenChangeKind.Added)]
    [InlineData(KitchenState.Ready, true, false, KitchenState.New, KitchenChangeKind.Added)]
    [InlineData(KitchenState.Served, true, false, KitchenState.New, KitchenChangeKind.Added)]
    [InlineData(KitchenState.Served, true, true, KitchenState.New, KitchenChangeKind.Changed)]
    [InlineData(KitchenState.Preparing, true, true, null, KitchenChangeKind.Changed)]
    [InlineData(KitchenState.Ready, false, false, null, KitchenChangeKind.None)]
    public void AfterEdit_FollowsTheEditingTable(
        KitchenState state, bool added, bool removed, KitchenState? expectedState, KitchenChangeKind expectedKind)
    {
        var outcome = KitchenBoardRules.AfterEdit(state, new KitchenLineDiff(added, removed, "note"));

        outcome.NewState.ShouldBe(expectedState);
        outcome.Kind.ShouldBe(expectedKind);
        outcome.Note.ShouldBe(expectedKind == KitchenChangeKind.None ? null : "note");
    }
}
