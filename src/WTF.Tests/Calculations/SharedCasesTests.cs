using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WTF.Calculations.Inventory;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Calculations.Subscriptions;
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

    private sealed record ReceiptLineCase(
        string Name, decimal Packs, decimal UnitsPerPack, decimal? PackPrice, decimal ExpectedQuantity, decimal? ExpectedUnitCost, decimal? ExpectedLineTotal);

    private sealed record InvoiceDifferenceCase(string Name, decimal? InvoiceTotal, List<decimal?> LineTotals, decimal? Expected);

    private sealed record AdjustmentCase(string Name, decimal Shown, decimal Counted, decimal Expected);

    private sealed record AddOnSelectionCase(string Name, string TypeName, bool IsRequired, int MinSelect, int MaxSelect, int Selected, string? ExpectedError, string ExpectedLabel);

    private sealed record SalesCoveredCase(string Name, decimal Balance, decimal PerSale, int Expected);

    private sealed record CashCase(string Name, decimal Total, decimal? Tips, decimal Received, decimal ExpectedDue, decimal ExpectedChange);

    private sealed record ShortfallBalanceCase(string ItemId, decimal Balance);

    private sealed record ShortfallLinkCase(string ProductId, string ItemId, decimal PerSale, string? ReplacesItemId = null);

    private sealed record ShortfallAddOnCase(string ProductId, int Quantity);

    private sealed record ShortfallLineCase(string ProductId, int Quantity, List<ShortfallAddOnCase> AddOns);

    private sealed record ShortfallSizeAmountCase(string ProductId, string SizeProductId, string ItemId, decimal Quantity);

    private sealed record ShortfallExpectedCase(string ItemId, decimal Needed, decimal Balance, decimal Short);

    private sealed record StockShortfallCase(
        string Name,
        List<ShortfallBalanceCase> Balances,
        List<ShortfallLinkCase> Links,
        List<ShortfallLineCase> Lines,
        List<ShortfallExpectedCase> Expected,
        List<ShortfallSizeAmountCase>? SizeAmounts = null);

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
        List<RecipeCostCase> RecipeCost,
        List<PriceForTargetMarginCase> PriceForTargetMargin,
        List<RecipePreviewCase> RecipePreview,
        List<SubscriptionWarningCase> SubscriptionWarnings,
        List<SubscriptionClockCase> SubscriptionClock,
        List<SubscriptionLeaseAgeCase> SubscriptionLeaseAge,
        List<AddOnSelectionCase> AddOnSelection,
        List<ReceiptLineCase> ReceiptLine,
        List<InvoiceDifferenceCase> InvoiceDifference);

    private sealed record RecipePreviewSizeAmountCase(string SizeProductId, decimal Quantity);

    private sealed record RecipePreviewLineCase(
        string ItemId,
        decimal QuantityPerSale,
        decimal AllowancePercent,
        string? ReplacesItemId,
        decimal? UnitCost,
        List<RecipePreviewSizeAmountCase> SizeAmounts);

    private sealed record RecipePreviewOptionCase(
        string ProductId,
        string Name,
        bool IsSize,
        decimal Price,
        List<RecipePreviewLineCase> Links);

    private sealed record RecipePreviewResultLineCase(string ItemId, decimal Quantity, decimal? LineCost, string? SourceName);

    private sealed record RecipePreviewExpectedCase(
        decimal Price,
        decimal TotalCost,
        int UnknownCostCount,
        decimal Margin,
        List<string> AddOnNames,
        List<RecipePreviewResultLineCase> Lines,
        List<string> ReplacedItemNames,
        List<string> Warnings);

    private sealed record RecipePreviewCase(
        string Name,
        decimal Price,
        decimal SuppliesCost,
        List<RecipePreviewLineCase> Lines,
        List<RecipePreviewOptionCase> Options,
        Dictionary<string, int> Chosen,
        RecipePreviewExpectedCase Expected);

    private sealed record PriceForTargetMarginCase(string Name, decimal Cost, decimal TargetPercent, decimal? Expected);

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

    private sealed record SubscriptionWarningCase(string Name, DateTime PeriodEnd, int GraceDays, DateTime Now, string ExpectedLevel, int ExpectedDaysLeft);

    private sealed record SubscriptionClockCase(string Name, DateTime DeviceNow, DateTime? LatestSeen, DateTime ExpectedNow);

    private sealed record SubscriptionLeaseAgeCase(string Name, DateTime IssuedAt, DateTime Now, int MaxAgeDays, bool Expected);

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

    public static IEnumerable<object[]> ReceiptLineCaseNames() => Loaded.Value.ReceiptLine.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> InvoiceDifferenceCaseNames() => Loaded.Value.InvoiceDifference.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> AdjustmentCaseNames() => Loaded.Value.StockAdjustment.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> AddOnSelectionCaseNames() => Loaded.Value.AddOnSelection.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> SalesCoveredCaseNames() => Loaded.Value.SalesCovered.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> StockShortfallCaseNames() => Loaded.Value.StockShortfalls.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> SubscriptionWarningCaseNames() => Loaded.Value.SubscriptionWarnings.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> SubscriptionClockCaseNames() => Loaded.Value.SubscriptionClock.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> SubscriptionLeaseAgeCaseNames() => Loaded.Value.SubscriptionLeaseAge.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> WasteNeedsReviewCaseNames() => Loaded.Value.WasteNeedsReview.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> WasteBalanceAfterCaseNames() => Loaded.Value.WasteBalanceAfter.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> RecipeCostCaseNames() => Loaded.Value.RecipeCost.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> PriceForTargetMarginCaseNames() => Loaded.Value.PriceForTargetMargin.Select(c => new object[] { c.Name });

    public static IEnumerable<object[]> RecipePreviewCaseNames() => Loaded.Value.RecipePreview.Select(c => new object[] { c.Name });

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
    [MemberData(nameof(AddOnSelectionCaseNames))]
    public void AddOnSelection_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.AddOnSelection.Single(x => x.Name == name);
        var rule = new AddOnTypeRule(1, c.TypeName, c.IsRequired, c.MinSelect, c.MaxSelect);

        AddOnSelectionRules.Check(rule, c.Selected).ShouldBe(c.ExpectedError);
    }

    [Theory]
    [MemberData(nameof(SalesCoveredCaseNames))]
    public void SalesCovered_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.SalesCovered.Single(x => x.Name == name);

        StockRules.SalesCovered(c.Balance, c.PerSale).ShouldBe(c.Expected);
    }

    [Theory]
    [MemberData(nameof(SubscriptionWarningCaseNames))]
    public void SubscriptionWarning_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.SubscriptionWarnings.Single(x => x.Name == name);

        SubscriptionRules.WarningLevel(c.PeriodEnd, c.GraceDays, c.Now).ToString().ShouldBe(c.ExpectedLevel, StringCompareShould.IgnoreCase);
        SubscriptionRules.DaysLeft(c.PeriodEnd, c.Now).ShouldBe(c.ExpectedDaysLeft);
    }

    [Theory]
    [MemberData(nameof(SubscriptionClockCaseNames))]
    public void SubscriptionClock_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.SubscriptionClock.Single(x => x.Name == name);

        SubscriptionRules.EffectiveNow(c.DeviceNow, c.LatestSeen).ShouldBe(c.ExpectedNow);
    }

    [Theory]
    [MemberData(nameof(SubscriptionLeaseAgeCaseNames))]
    public void SubscriptionLeaseAge_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.SubscriptionLeaseAge.Single(x => x.Name == name);

        SubscriptionRules.LeaseTooOld(c.IssuedAt, c.Now, c.MaxAgeDays).ShouldBe(c.Expected);
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
    [MemberData(nameof(PriceForTargetMarginCaseNames))]
    public void PriceForTargetMargin_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.PriceForTargetMargin.Single(x => x.Name == name);

        CostRules.PriceForTargetMargin(c.Cost, c.TargetPercent).ShouldBe(c.Expected);
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
    [MemberData(nameof(RecipePreviewCaseNames))]
    public void RecipePreview_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.RecipePreview.Single(x => x.Name == name);
        var drinkId = IdFor("drink");
        var parent = new StockLine(Guid.NewGuid(), null, drinkId, 1);
        var chosen = c.Options.Where(option => c.Chosen.GetValueOrDefault(option.ProductId) > 0).ToList();
        var stockLines = new List<StockLine> { parent };
        stockLines.AddRange(chosen.Select(option => new StockLine(Guid.NewGuid(), parent.LineId, IdFor(option.ProductId), c.Chosen[option.ProductId])));

        var links = c.Lines
            .Select(line => new StockLink(
                drinkId, IdFor(line.ItemId), CostRules.EffectiveQuantity(line.QuantityPerSale, line.AllowancePercent),
                line.ReplacesItemId is null ? null : IdFor(line.ReplacesItemId)))
            .Concat(chosen.SelectMany(option => option.Links.Select(link => new StockLink(
                IdFor(option.ProductId), IdFor(link.ItemId), CostRules.EffectiveQuantity(link.QuantityPerSale, link.AllowancePercent),
                link.ReplacesItemId is null ? null : IdFor(link.ReplacesItemId)))))
            .ToList();
        var sizeAmounts = c.Lines
            .SelectMany(line => line.SizeAmounts.Select(amount => new StockSizeAmount(drinkId, IdFor(amount.SizeProductId), IdFor(line.ItemId), amount.Quantity)))
            .ToList();

        var unitCostByItem = c.Lines.Select(line => (line.ItemId, line.UnitCost))
            .Concat(chosen.SelectMany(option => option.Links.Select(link => (link.ItemId, link.UnitCost))))
            .GroupBy(entry => IdFor(entry.ItemId))
            .ToDictionary(group => group.Key, group => group.First().UnitCost);
        var nameById = unitCostByItem.Keys.ToDictionary(id => id, id => c.Lines.Select(l => l.ItemId)
            .Concat(chosen.SelectMany(o => o.Links.Select(l => l.ItemId))).First(itemName => IdFor(itemName) == id));
        var sourceNames = chosen.ToDictionary(option => IdFor(option.ProductId), option => option.Name);

        var required = StockRules.Requirements(stockLines, links, sizeAmounts);
        var costLines = new List<(string ItemId, decimal Quantity, decimal? UnitCost, string? SourceName)>();
        var replaced = new List<string>();
        foreach (var requirement in required)
        {
            var itemName = nameById[requirement.ItemId];
            if (requirement.Quantity <= 0m)
            {
                replaced.Add(itemName);
                continue;
            }

            costLines.Add((itemName, requirement.Quantity, unitCostByItem[requirement.ItemId], requirement.ProductId == drinkId ? null : sourceNames[requirement.ProductId]));
        }

        costLines = costLines
            .OrderBy(line => line.SourceName is not null)
            .ThenBy(line => line.SourceName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(line => line.ItemId, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var summary = CostRules.RecipeCost(costLines.Select(line => new RecipeLine(line.Quantity, line.UnitCost)), c.SuppliesCost);
        var price = c.Price + chosen.Sum(option => option.Price * c.Chosen[option.ProductId]);

        price.ShouldBe(c.Expected.Price);
        summary.TotalCost.ShouldBe(c.Expected.TotalCost);
        summary.UnknownCostCount.ShouldBe(c.Expected.UnknownCostCount);
        CostRules.Margin(price, summary.TotalCost).ShouldBe(c.Expected.Margin);
        costLines
            .Select(line => new RecipePreviewResultLineCase(
                line.ItemId, line.Quantity, line.UnitCost.HasValue ? CostRules.LineCost(line.Quantity, line.UnitCost.Value) : null, line.SourceName))
            .ShouldBe(c.Expected.Lines);
        replaced.Distinct().OrderBy(itemName => itemName).ToList().ShouldBe(c.Expected.ReplacedItemNames);
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
                addOn.Quantity)));
        }

        var links = c.Links.Select(link => new StockLink(
            IdFor(link.ProductId),
            IdFor(link.ItemId),
            link.PerSale,
            link.ReplacesItemId is null ? null : IdFor(link.ReplacesItemId))).ToList();
        var balances = c.Balances.ToDictionary(balance => IdFor(balance.ItemId), balance => balance.Balance);

        var result = StockRules.Shortfalls(
            lines,
            links,
            balances,
            c.SizeAmounts?.Select(a => new StockSizeAmount(IdFor(a.ProductId), IdFor(a.SizeProductId), IdFor(a.ItemId), a.Quantity)).ToList());

        result.Select(r => (r.ItemId, r.Needed, r.Balance, r.Short))
            .ShouldBe(c.Expected.Select(e => (IdFor(e.ItemId), e.Needed, e.Balance, e.Short)).ToList());
    }

    [Theory]
    [MemberData(nameof(ReceiptLineCaseNames))]
    public void ReceiptLine_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.ReceiptLine.Single(x => x.Name == name);

        PurchasingRules.UnitsFromPacks(c.Packs, c.UnitsPerPack).ShouldBe(c.ExpectedQuantity);
        PurchasingRules.UnitCost(c.PackPrice, c.UnitsPerPack).ShouldBe(c.ExpectedUnitCost);
        PurchasingRules.LineTotal(c.Packs, c.PackPrice).ShouldBe(c.ExpectedLineTotal);
    }

    [Theory]
    [MemberData(nameof(InvoiceDifferenceCaseNames))]
    public void InvoiceDifference_MatchesTheSharedCase(string name)
    {
        var c = Loaded.Value.InvoiceDifference.Single(x => x.Name == name);

        PurchasingRules.InvoiceDifference(c.InvoiceTotal, c.LineTotals).ShouldBe(c.Expected);
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
