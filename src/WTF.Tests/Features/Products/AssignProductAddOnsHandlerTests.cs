using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class AssignProductAddOnsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private AssignProductAddOnsHandler Handler() => new(TestDb.Create(_dbName));

    private static AssignProductAddOnsCommand Command(Guid productId, params ProductAddOnAssignmentDto[] addOns) =>
        new() { ProductId = productId, AddOns = [.. addOns] };

    [Fact]
    public async Task Handle_UnknownProduct_ReturnsFalse()
    {
        var result = await Handler().Handle(Command(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_ProductIsItselfAnAddOn_Throws()
    {
        var addOn = ProductSeed.NewProduct(isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, addOn);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(addOn.Id), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_DuplicateAddOnIds_Throws()
    {
        var product = ProductSeed.NewProduct();
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, addOn);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(product.Id, new ProductAddOnAssignmentDto(addOn.Id, AddOnTypeEnum.Extra), new ProductAddOnAssignmentDto(addOn.Id, AddOnTypeEnum.Size)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_UndefinedAddOnType_Throws()
    {
        var product = ProductSeed.NewProduct();
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, addOn);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(product.Id, new ProductAddOnAssignmentDto(addOn.Id, (AddOnTypeEnum)99)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_UnknownAddOnId_Throws()
    {
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, product);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(product.Id, new ProductAddOnAssignmentDto(Guid.NewGuid(), AddOnTypeEnum.Extra)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_RequestedProductIsNotAnAddOn_ThrowsNamingIt()
    {
        var product = ProductSeed.NewProduct();
        var notAddOn = ProductSeed.NewProduct(name: "Plain Cake", code: "PC");
        await ProductSeed.SeedAsync(_dbName, product, notAddOn);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(product.Id, new ProductAddOnAssignmentDto(notAddOn.Id, AddOnTypeEnum.Extra)), CancellationToken.None));

        ex.Message.ShouldContain("Plain Cake");
    }

    [Fact]
    public async Task Handle_NewAddOns_CreatesLinksWithRequestedTypes()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var syrup = ProductSeed.NewProduct(name: "Syrup", code: "SY", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, syrup);

        var result = await Handler().Handle(
            Command(product.Id, new ProductAddOnAssignmentDto(shot.Id, AddOnTypeEnum.Extra), new ProductAddOnAssignmentDto(syrup.Id, AddOnTypeEnum.Flavor)), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var links = await db.ProductAddOns.Where(l => l.ProductId == product.Id).ToListAsync();
        links.Count.ShouldBe(2);
        links.Single(l => l.AddOnId == shot.Id).AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Extra);
        links.Single(l => l.AddOnId == syrup.Id).AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Flavor);
    }

    [Fact]
    public async Task Handle_AddOnRemovedFromRequest_DeactivatesLinkButKeepsRowAndOverride()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var syrup = ProductSeed.NewProduct(name: "Syrup", code: "SY", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, syrup,
            ProductSeed.NewLink(product.Id, shot.Id), ProductSeed.NewLink(product.Id, syrup.Id),
            ProductSeed.NewOverride(product.Id, syrup.Id, 5m));

        await Handler().Handle(Command(product.Id, new ProductAddOnAssignmentDto(shot.Id, AddOnTypeEnum.Extra)), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync(l => l.AddOnId == syrup.Id)).IsActive.ShouldBeFalse();
        (await db.ProductAddOns.SingleAsync(l => l.AddOnId == shot.Id)).IsActive.ShouldBeTrue();
        (await db.ProductAddOnPriceOverrides.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_PreviouslyRemovedAddOnReAdded_ReactivatesExistingLinkWithoutDuplicate()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot,
            ProductSeed.NewLink(product.Id, shot.Id, typeId: (int)AddOnTypeEnum.Extra, isActive: false));

        await Handler().Handle(Command(product.Id, new ProductAddOnAssignmentDto(shot.Id, AddOnTypeEnum.Sauce)), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var link = await db.ProductAddOns.SingleAsync();
        link.IsActive.ShouldBeTrue();
        link.AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Sauce);
    }

    [Fact]
    public async Task Handle_AddOnTypeChangedForExistingLink_UpdatesType()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id, typeId: (int)AddOnTypeEnum.Extra));

        await Handler().Handle(Command(product.Id, new ProductAddOnAssignmentDto(shot.Id, AddOnTypeEnum.Topping)), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync()).AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Topping);
    }

    [Fact]
    public async Task Handle_EmptyRequest_DeactivatesAllLinks()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id));

        var result = await Handler().Handle(Command(product.Id), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync()).IsActive.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_RemovedAddOn_DecouplesItFromPendingOrderItemsOnly()
    {
        var product = ProductSeed.NewProduct();
        var shot = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var pendingOrder = new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Pending };
        var completedOrder = new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Completed };
        var pendingParent = new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, ProductId = product.Id, Quantity = 1 };
        var pendingChild = new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, ProductId = shot.Id, Quantity = 1, ParentOrderItemId = pendingParent.Id };
        var doneParent = new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, ProductId = product.Id, Quantity = 1 };
        var doneChild = new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, ProductId = shot.Id, Quantity = 1, ParentOrderItemId = doneParent.Id };
        await ProductSeed.SeedAsync(_dbName, product, shot, ProductSeed.NewLink(product.Id, shot.Id),
            pendingOrder, completedOrder, pendingParent, pendingChild, doneParent, doneChild);

        await Handler().Handle(Command(product.Id), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.OrderItems.SingleAsync(i => i.Id == pendingChild.Id)).ParentOrderItemId.ShouldBeNull();
        (await db.OrderItems.SingleAsync(i => i.Id == doneChild.Id)).ParentOrderItemId.ShouldBe(doneParent.Id);
    }
}
