using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WTF.Calculations.Inventory;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Tests.Calculations;

/// <summary>
/// Runs the sample orders and discounts in <c>calculation-cases.json</c> through the API calculators. The Angular specs in
/// <c>shared/calculations</c> run the same file through their own calculators, so the POS and the API cannot quietly
/// disagree: a rule changed on one side without the other fails one of the two test runs.
/// </summary>
public class SharedCasesTests
{
    private static readonly IReadOnlyDictionary<(Guid ProductId, Guid AddOnId), decimal> NoOverrides =
        new Dictionary<(Guid ProductId, Guid AddOnId), decimal>();

    private sealed record AddOnCase(decimal Price, int Quantity);

    private sealed record LineCase(int Quantity, decimal Price, List<AddOnCase> AddOns);

    private sealed record BundleCase(decimal UnitPrice, int Quantity, List<LineCase> Items);

    private sealed record OrderCase(
        string Name, List<LineCase> Lines, List<BundleCase> Bundles, decimal ExpectedTotal, List<decimal>? ExpectedLineTotals);

    private sealed record DiscountCase(string Name, decimal BasePrice, decimal? FixedPrice, decimal? PercentOff, decimal? Expected);

    private sealed record LabelCase(string Name, decimal? FixedPrice, decimal? PercentOff, decimal? BasePrice, decimal? AddOnsPerUnit, string? Expected);

    private sealed record IdQuantity(string Id, int Quantity);

    private sealed record RuleCase(decimal? FixedPrice, decimal? PercentOff, List<IdQuantity> RequiredAddOns, int? Remaining = null, int? MaxPerOrder = null);

    private sealed record ExpectedDiscount(decimal Price, string? Label, int? DiscountedQuantity = null);

    private sealed record BestDiscountCase(
        string Name, decimal BasePrice, List<IdQuantity> CartAddOns, List<RuleCase> Rules, ExpectedDiscount? Expected, int? Quantity = null);

    private sealed record AverageCase(string Name, decimal Amount, int Count, decimal Expected);

    private sealed record PercentCase(string Name, decimal Part, decimal Total, decimal Expected);

    private sealed record ScheduleCase(string Name, byte? DaysOfWeek, string? StartTime, string? EndTime, string Local, bool Expected);

    private sealed record AdjustmentCase(string Name, decimal Shown, decimal Counted, decimal Expected);

    private sealed record SalesCoveredCase(string Name, decimal Balance, decimal PerSale, int Expected);

    private sealed record CashCase(string Name, decimal Total, decimal? Tips, decimal Received, decimal ExpectedDue, decimal ExpectedChange);

    private sealed record ShortfallBalanceCase(string ItemId, decimal Balance);

    private sealed record ShortfallLinkCase(string ProductId, string ItemId, decimal PerSale, bool ScalesWithSize = false, string? ReplacesItemId = null);

    private sealed record ShortfallMultiplierCase(string ProductId, decimal Multiplier);

    private sealed record ShortfallAddOnCase(string ProductId, int Quantity);

    private sealed record ShortfallLineCase(string ProductId, int Quantity, List<ShortfallAddOnCase> AddOns);

    private sealed record ShortfallExpectedCase(string ItemId, decimal Needed, decimal Balance, decimal Short);

    private sealed record StockShortfallCase(
        string Name,
        List<ShortfallBalanceCase> Balances,
        List<ShortfallLinkCase> Links,
        List<ShortfallLineCase> Lines,
        List<ShortfallExpectedCase> Expected,
        List<ShortfallMultiplierCase>? Multipliers = null);

    private sealed record Cases(
        List<OrderCase> OrderTotals,
        List<DiscountCase> DiscountedUnitPrice,
        List<LabelCase> PromoLabels,
        List<BestDiscountCase> BestDiscount,
        List<AverageCase> Average,
        List<PercentCase> PercentOfTotal,
        List<CashCase> CashPayment,
        List<ScheduleCase> ScheduleOpen,
        List<AdjustmentCase> StockAdjustment,
        List<SalesCoveredCase> SalesCovered,
        List<StockShortfallCase> StockShortfalls,
        List<WasteNeedsReviewCase> WasteNeedsReview,
        List<WasteBalanceAfterCase> WasteBalanceAfter,
        List<RecipeCostCase> RecipeCost);

    private sealed record RecipeCostLineCase(decimal QuantityPerSale, decimal AllowancePercent, decimal? UnitCost);

    private sealed record RecipeCostCase(
        string Name,
        decimal Price,
        decimal SuppliesCost,
        List<RecipeCostLineCase> Lines,
        decimal TotalCost,
        int UnknownCostCount,
        decimal Margin,
        decimal? MarginPercent);

    private sealed record WasteNeedsReviewCase(string Name, decimal Quantity, decimal? Limit, bool Expected);

    private sealed record WasteBalanceAfterCase(string Name, decimal Balance, decimal Quantity, decimal Expected);

    private static readonly Lazy<Cases> Loaded = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Calculations", "calculation-cases.json");
        return JsonSerializer.Deserialize<Cases>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    });

    public static IEnumerable<object[]> OrderCaseNames() => Loaded.Value.OrderTotals.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> DiscountCaseNames() => Loaded.Value.DiscountedUnitPrice.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> LabelCaseNames() => Loaded.Value.PromoLabels.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> BestDiscountCaseNames() => Loaded.Value.BestDiscount.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> ScheduleCaseNames() => Loaded.Value.ScheduleOpen.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> AverageCaseNames() => Loaded.Value.Average.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> PercentCaseNames() => Loaded.Value.PercentOfTotal.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> CashCaseNames() => Loaded.Value.CashPayment.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> AdjustmentCaseNames() => Loaded.Value.StockAdjustment.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> SalesCoveredCaseNames() => Loaded.Value.SalesCovered.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> StockShortfallCaseNames() => Loaded.Value.StockShortfalls.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> WasteNeedsReviewCaseNames() => Loaded.Value.WasteNeedsReview.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> WasteBalanceAfterCaseNames() => Loaded.Value.WasteBalanceAfter.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> RecipeCostCaseNames() => Loaded.Value.RecipeCost.Select(c => new object[] { c.Name });

    /// <summary>A stable id for a name in the file, so "cheese" is the same add-on in the cart and in the rule.</summary>
    private static Guid IdFor(string name) => new(MD5.HashData(Encoding.UTF8.GetBytes(name)));

    private static (OrderItem Parent, List<OrderItem> Children) BuildLine(Order order, LineCase line, Guid? bundleId = null)
    {
        var product = new Product { Id = Guid.NewGuid(), Price = line.Price };
        var parent = new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            ProductId = product.Id,
            Product = product,
            Quantity = line.Quantity,
            Price = line.Price,
            BundlePromotionId = bundleId,
        };
        order.OrderItems.Add(parent);

        var children = new List<OrderItem>();
        foreach (var addOn in line.AddOns)
        {
            var addOnProduct = new Product { Id = Guid.NewGuid(), Price = addOn.Price };
            var child = new OrderItem
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                ProductId = addOnProduct.Id,
                Product = addOnProduct,
                Quantity = addOn.Quantity,
                Price = addOn.Price,
                ParentOrderItemId = parent.Id,
                BundlePromotionId = bundleId,
            };
            order.OrderItems.Add(child);
            children.Add(child);
        }

        return (parent, children);
    }

    [Theory]
    [MemberData(nameof(OrderCaseNames))]
    public void OrderTotal_MatchesTheSharedCase(string name)
    {
        var orderCase = Loaded.Value.OrderTotals.Single(c => c.Name == name);
        var order = new Order { Id = Guid.NewGuid() };
        var lines = orderCase.Lines.Select(line => BuildLine(order, line)).ToList();

        foreach (var bundle in orderCase.Bundles)
        {
            var promotionId = Guid.NewGuid();
            order.OrderBundlePromotions.Add(new OrderBundlePromotion
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                PromotionId = promotionId,
                Quantity = bundle.Quantity,
                UnitPrice = bundle.UnitPrice,
            });
            foreach (var item in bundle.Items)
            {
                BuildLine(order, item, promotionId);
            }
        }

        OrderMetrics.ComputeOrderTotal(order, NoOverrides).ShouldBe(orderCase.ExpectedTotal);

        if (orderCase.ExpectedLineTotals is not null)
        {
            lines.Select(l => OrderMetrics.ComputeParentItemTotal(l.Parent, l.Children, NoOverrides))
                .ShouldBe(orderCase.ExpectedLineTotals);
        }
    }

    [Theory]
    [MemberData(nameof(CashCaseNames))]
    public void CashPayment_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.CashPayment.Single(x => x.Name == name);

        CashPayment.AmountDue(c.Total, c.Tips).ShouldBe(c.ExpectedDue);
        CashPayment.Change(c.Received, c.Total, c.Tips).ShouldBe(c.ExpectedChange);
        CashPayment.ChangeToGive(c.Received, c.Total, c.Tips).ShouldBe(Math.Max(0m, c.ExpectedChange));
    }

    [Theory]
    [MemberData(nameof(SalesCoveredCaseNames))]
    public void SalesCovered_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.SalesCovered.Single(x => x.Name == name);

        StockRules.SalesCovered(c.Balance, c.PerSale).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(WasteNeedsReviewCaseNames))]
    public void WasteNeedsReview_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.WasteNeedsReview.Single(x => x.Name == name);

        WasteRules.NeedsReview(c.Quantity, c.Limit).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(WasteBalanceAfterCaseNames))]
    public void WasteBalanceAfter_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.WasteBalanceAfter.Single(x => x.Name == name);

        WasteRules.BalanceAfter(c.Balance, c.Quantity).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(RecipeCostCaseNames))]
    public void RecipeCost_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.RecipeCost.Single(x => x.Name == name);

        var summary = CostRules.RecipeCost(
            c.Lines.Select(l => new RecipeLine(CostRules.EffectiveQuantity(l.QuantityPerSale, l.AllowancePercent), l.UnitCost)),
            c.SuppliesCost);

        summary.TotalCost.ShouldBe(c.TotalCost);
        summary.UnknownCostCount.ShouldBe(c.UnknownCostCount);
        CostRules.Margin(c.Price, summary.TotalCost).ShouldBe(c.Margin);
        CostRules.MarginPercent(c.Price, summary.TotalCost).ShouldBe(c.MarginPercent);
    }

    [Theory]
    [MemberData(nameof(StockShortfallCaseNames))]
    public void StockShortfalls_MatchTheSharedCase(string name)
    {
        var c = Loaded.Value.StockShortfalls.Single(x => x.Name == name);
        var lines = new List<StockLine>();
        foreach (var line in c.Lines)
        {
            var lineId = Guid.NewGuid();
            lines.Add(new StockLine(lineId, null, IdFor(line.ProductId), line.Quantity));
            lines.AddRange(line.AddOns.Select(addOn => new StockLine(
                Guid.NewGuid(),
                lineId,
                IdFor(addOn.ProductId),
                addOn.Quantity,
                c.Multipliers?.SingleOrDefault(m => m.ProductId == addOn.ProductId)?.Multiplier ?? 1m)));
        }

        var links = c.Links.Select(link => new StockLink(
            IdFor(link.ProductId),
            IdFor(link.ItemId),
            link.PerSale,
            link.ScalesWithSize,
            link.ReplacesItemId is null ? null : IdFor(link.ReplacesItemId))).ToList();
        var balances = c.Balances.ToDictionary(balance => IdFor(balance.ItemId), balance => balance.Balance);

        var result = StockRules.Shortfalls(lines, links, balances);

        result.Select(r => (r.ItemId, r.Needed, r.Balance, r.Short))
            .ShouldBe(c.Expected.Select(e => (IdFor(e.ItemId), e.Needed, e.Balance, e.Short)).ToList());
    }

    [Theory]
    [MemberData(nameof(AdjustmentCaseNames))]
    public void StockAdjustment_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.StockAdjustment.Single(x => x.Name == name);

        StockRules.AdjustmentDelta(c.Shown, c.Counted).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(AverageCaseNames))]
    public void Average_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.Average.Single(x => x.Name == name);

        Math.Round(SalesRules.Average(c.Amount, c.Count), 4).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(PercentCaseNames))]
    public void PercentOfTotal_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.PercentOfTotal.Single(x => x.Name == name);

        Math.Round(SalesRules.PercentOfTotal(c.Part, c.Total), 4).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(DiscountCaseNames))]
    public void DiscountedUnitPrice_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.DiscountedUnitPrice.Single(x => x.Name == name);

        PromotionPricing.CalculateDiscountedUnitPrice(c.BasePrice, c.FixedPrice, c.PercentOff).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(LabelCaseNames))]
    public void PromoLabel_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.PromoLabels.Single(x => x.Name == name);

        PromotionLabelFormatter.Format(c.FixedPrice, c.PercentOff, c.BasePrice, c.AddOnsPerUnit ?? 0m).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(ScheduleCaseNames))]
    public void ScheduleOpen_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.ScheduleOpen.Single(x => x.Name == name);

        PromotionSchedule.IsOpen(
            c.DaysOfWeek,
            c.StartTime is null ? null : TimeOnly.Parse(c.StartTime),
            c.EndTime is null ? null : TimeOnly.Parse(c.EndTime),
            DateTime.Parse(c.Local, System.Globalization.CultureInfo.InvariantCulture)).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(BestDiscountCaseNames))]
    public void BestDiscount_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.BestDiscount.Single(x => x.Name == name);
        var productId = Guid.NewGuid();
        // A rule with a usage limit is a promotion of its own, so the budget knows how many uses it has left.
        var promotionIds = c.Rules.Select(_ => Guid.NewGuid()).ToList();
        var rules = new Dictionary<Guid, List<PromotionPricing.DiscountedRule>>
        {
            [productId] = [.. c.Rules.Select((r, index) => new PromotionPricing.DiscountedRule(
                r.FixedPrice,
                r.PercentOff,
                [.. r.RequiredAddOns.Select(a => (IdFor(a.Id), a.Quantity))],
                promotionIds[index],
                r.MaxPerOrder))],
        };
        var remaining = c.Rules
            .Select((r, index) => (Id: promotionIds[index], r.Remaining))
            .Where(x => x.Remaining.HasValue)
            .ToDictionary(x => x.Id, x => x.Remaining!.Value);
        var perOrder = c.Rules
            .Select((r, index) => (Id: promotionIds[index], r.MaxPerOrder))
            .Where(x => x.MaxPerOrder.HasValue)
            .ToDictionary(x => x.Id, x => x.MaxPerOrder!.Value);

        var result = PromotionPricing.GetDiscountedUnitPrice(
            c.BasePrice,
            productId,
            c.CartAddOns.Select(a => (IdFor(a.Id), a.Quantity)),
            rules,
            c.Quantity ?? 1,
            new DiscountBudget(remaining, perOrder));

        if (c.Expected is null)
        {
            result.ShouldBeNull();
            return;
        }

        result.ShouldNotBeNull();
        result.Price.ShouldBe(c.Expected.Price);
        result.Label.ShouldBe(c.Expected.Label);
        result.DiscountedQuantity.ShouldBe(c.Expected.DiscountedQuantity ?? c.Quantity ?? 1);
    }
}
