using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Tests.Features.Orders;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Inventory;

public class BulkAddProductIngredientsTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly IAuditService _audit = TestFakes.Audit();
    private readonly OrderSeed _data;

    private readonly Guid _latte;
    private readonly Guid _mocha;
    private readonly Guid _cup;
    private readonly Guid _lid;

    public BulkAddProductIngredientsTests()
    {
        _data = new OrderSeed(_db);
        _latte = _data.AddProduct("Latte", 150m);
        _mocha = _data.AddProduct("Mocha", 160m);
        _cup = StockSeed.Item(_db, "Cup", 100m);
        _lid = StockSeed.Item(_db, "Lid", 100m);
    }

    private Task<BulkAddProductIngredientsResult> Run(IEnumerable<Guid> products, params BulkIngredientLineDto[] lines) =>
        new BulkAddProductIngredientsHandler(TestDb.Create(_db), TestRequest.As(_userId), _audit)
            .Handle(new BulkAddProductIngredientsCommand { ProductIds = [.. products], Lines = [.. lines] }, CancellationToken.None);

    [Fact]
    public async Task AddsEveryLineToEveryProduct()
    {
        var result = await Run([_latte, _mocha], new BulkIngredientLineDto(_cup, 1m), new BulkIngredientLineDto(_lid, 1m));

        result.Added.ShouldBe(4);
        result.Skipped.ShouldBeEmpty();
        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.CountAsync(l => l.IsActive)).ShouldBe(4);
    }

    [Fact]
    public async Task AProductThatAlreadyHasTheIngredient_KeepsItsAmountAndIsListedAsSkipped()
    {
        StockSeed.Link(_db, _latte, _cup, 2m);

        var result = await Run([_latte, _mocha], new BulkIngredientLineDto(_cup, 1m));

        result.Added.ShouldBe(1);
        result.Skipped.Single().ProductName.ShouldBe("Latte");
        result.Skipped.Single().ItemName.ShouldBe("Cup");
        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.SingleAsync(l => l.ProductId == _latte)).QuantityPerSale.ShouldBe(2m);
    }

    [Fact]
    public async Task ALineSwitchedOffEarlier_ComesBackWithTheNewAmount()
    {
        StockSeed.Link(_db, _latte, _cup, 2m, active: false);

        var result = await Run([_latte], new BulkIngredientLineDto(_cup, 1m, 5m));

        result.Added.ShouldBe(1);
        await using var db = TestDb.Create(_db);
        var link = await db.ProductItemLinks.SingleAsync();
        link.IsActive.ShouldBeTrue();
        link.QuantityPerSale.ShouldBe(1m);
        link.AllowancePercent.ShouldBe(5m);
    }

    [Fact]
    public async Task IsAudited()
    {
        await Run([_latte], new BulkIngredientLineDto(_cup, 1m));

        await _audit.Received(1).LogAsync(
            AuditAction.ProductItemLinked, AuditEntityType.ProductItemLink, _latte.ToString(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NoProducts_IsRefused() =>
        (await Should.ThrowAsync<InvalidOperationException>(() => Run([], new BulkIngredientLineDto(_cup, 1m))))
            .Message.ShouldContain("at least one product");

    [Fact]
    public async Task NoLines_IsRefused() =>
        (await Should.ThrowAsync<InvalidOperationException>(() => Run([_latte])))
            .Message.ShouldContain("at least one ingredient");

    [Fact]
    public async Task TheSameIngredientTwice_IsRefused() =>
        (await Should.ThrowAsync<InvalidOperationException>(() =>
            Run([_latte], new BulkIngredientLineDto(_cup, 1m), new BulkIngredientLineDto(_cup, 2m))))
            .Message.ShouldContain("only once");

    [Fact]
    public async Task AnAmountOfZero_IsRefused() =>
        await Should.ThrowAsync<InvalidOperationException>(() => Run([_latte], new BulkIngredientLineDto(_cup, 0m)));

    [Fact]
    public async Task AnUnknownProduct_IsRefused() =>
        (await Should.ThrowAsync<InvalidOperationException>(() => Run([Guid.NewGuid()], new BulkIngredientLineDto(_cup, 1m))))
            .Message.ShouldContain("products were not found");

    [Fact]
    public async Task AnUnknownItem_IsRefused() =>
        (await Should.ThrowAsync<InvalidOperationException>(() => Run([_latte], new BulkIngredientLineDto(Guid.NewGuid(), 1m))))
            .Message.ShouldContain("ingredients were not found");

    [Fact]
    public async Task ADeletedProduct_IsRefusedAndNothingIsSaved()
    {
        var gone = _data.AddProduct("Gone", 10m, isActive: false);

        await Should.ThrowAsync<InvalidOperationException>(() => Run([_latte, gone], new BulkIngredientLineDto(_cup, 1m)));

        await using var db = TestDb.Create(_db);
        (await db.ProductItemLinks.CountAsync()).ShouldBe(0);
    }
}
