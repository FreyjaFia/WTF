using WTF.Calculations.Inventory;

namespace WTF.Tests.Calculations;

public class StockAlertRulesTests
{
    [Theory]
    [InlineData(StockStatus.Ok, StockStatus.Warning)]
    [InlineData(StockStatus.Ok, StockStatus.Critical)]
    [InlineData(StockStatus.Ok, StockStatus.OutOfStock)]
    [InlineData(StockStatus.Warning, StockStatus.Critical)]
    [InlineData(StockStatus.Warning, StockStatus.OutOfStock)]
    [InlineData(StockStatus.Critical, StockStatus.OutOfStock)]
    public void GettingWorse_Notifies_AndRemembersTheNewLevel(StockStatus last, StockStatus current)
    {
        var decision = StockAlertRules.Decide(last, current);

        decision.Notify.ShouldBeTrue();
        decision.Remember.ShouldBe(current);
    }

    [Theory]
    [InlineData(StockStatus.Warning, StockStatus.Warning)]
    [InlineData(StockStatus.Critical, StockStatus.Critical)]
    [InlineData(StockStatus.OutOfStock, StockStatus.OutOfStock)]
    public void StayingAtTheSameLevel_DoesNotNotifyAgain(StockStatus last, StockStatus current)
    {
        var decision = StockAlertRules.Decide(last, current);

        decision.Notify.ShouldBeFalse();
        decision.Remember.ShouldBe(current);
    }

    [Theory]
    [InlineData(StockStatus.Critical, StockStatus.Warning)]
    [InlineData(StockStatus.OutOfStock, StockStatus.Critical)]
    [InlineData(StockStatus.OutOfStock, StockStatus.Warning)]
    public void PartialRecovery_IsRememberedWithoutNotifying(StockStatus last, StockStatus current)
    {
        var decision = StockAlertRules.Decide(last, current);

        decision.Notify.ShouldBeFalse();
        decision.Remember.ShouldBe(current);
    }

    [Theory]
    [InlineData(StockStatus.Warning)]
    [InlineData(StockStatus.Critical)]
    [InlineData(StockStatus.OutOfStock)]
    public void BackToOk_ForgetsTheLastAlert(StockStatus last)
    {
        var decision = StockAlertRules.Decide(last, StockStatus.Ok);

        decision.Notify.ShouldBeFalse();
        decision.Remember.ShouldBe(StockStatus.Ok);
    }

    [Fact]
    public void OkToOk_ChangesNothing()
    {
        var decision = StockAlertRules.Decide(StockStatus.Ok, StockStatus.Ok);

        decision.Notify.ShouldBeFalse();
        decision.Remember.ShouldBe(StockStatus.Ok);
    }
}
