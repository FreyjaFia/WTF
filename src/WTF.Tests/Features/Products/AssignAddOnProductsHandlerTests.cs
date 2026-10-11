using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Products;

public class AssignAddOnProductsHandlerTests
{
    private readonly string _dbName = TestDb.NewName();

    private AssignAddOnProductsHandler Handler() => new(TestDb.Create(_dbName));

    private static AssignAddOnProductsCommand Command(Guid addOnId, params AddOnProductAssignmentDto[] products) =>
        new() { AddOnId = addOnId, Products = [.. products] };

    [Fact]
    public async Task Handle_UnknownAddOn_ReturnsFalse()
    {
        var result = await Handler().Handle(Command(Guid.NewGuid()), CancellationToken.None);

        result.ShouldBeFalse();
    }

    [Fact]
    public async Task Handle_TargetIsNotAnAddOn_Throws()
    {
        var notAddOn = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, notAddOn);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(Command(notAddOn.Id), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_DuplicateProductIds_Throws()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, addOn, product);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(addOn.Id, new AddOnProductAssignmentDto(product.Id, AddOnTypeEnum.Extra), new AddOnProductAssignmentDto(product.Id, AddOnTypeEnum.Size)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_UndefinedAddOnType_Throws()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, addOn, product);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(addOn.Id, new AddOnProductAssignmentDto(product.Id, (AddOnTypeEnum)0)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_UnknownProductId_Throws()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, addOn);

        await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(addOn.Id, new AddOnProductAssignmentDto(Guid.NewGuid(), AddOnTypeEnum.Extra)), CancellationToken.None));
    }

    [Fact]
    public async Task Handle_RequestedProductIsAnAddOn_ThrowsNamingIt()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var other = ProductSeed.NewProduct(name: "Syrup", code: "SY", isAddOn: true);
        await ProductSeed.SeedAsync(_dbName, addOn, other);

        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Handler().Handle(
            Command(addOn.Id, new AddOnProductAssignmentDto(other.Id, AddOnTypeEnum.Extra)), CancellationToken.None));

        ex.Message.ShouldContain("Syrup");
    }

    [Fact]
    public async Task Handle_NewProducts_CreatesLinksWithRequestedTypes()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var p1 = ProductSeed.NewProduct(name: "P1", code: "P1");
        var p2 = ProductSeed.NewProduct(name: "P2", code: "P2");
        await ProductSeed.SeedAsync(_dbName, addOn, p1, p2);

        var result = await Handler().Handle(
            Command(addOn.Id, new AddOnProductAssignmentDto(p1.Id, AddOnTypeEnum.Extra), new AddOnProductAssignmentDto(p2.Id, AddOnTypeEnum.Sauce)), CancellationToken.None);

        result.ShouldBeTrue();
        await using var db = TestDb.Create(_dbName);
        var links = await db.ProductAddOns.Where(l => l.AddOnId == addOn.Id).ToListAsync();
        links.Count.ShouldBe(2);
        links.Single(l => l.ProductId == p1.Id).AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Extra);
        links.Single(l => l.ProductId == p2.Id).AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Sauce);
    }

    [Fact]
    public async Task Handle_ProductRemovedFromRequest_DeactivatesLinkButKeepsRowAndOverride()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var p1 = ProductSeed.NewProduct(name: "P1", code: "P1");
        var p2 = ProductSeed.NewProduct(name: "P2", code: "P2");
        await ProductSeed.SeedAsync(_dbName, addOn, p1, p2,
            ProductSeed.NewLink(p1.Id, addOn.Id), ProductSeed.NewLink(p2.Id, addOn.Id),
            ProductSeed.NewOverride(p2.Id, addOn.Id, 3m));

        await Handler().Handle(Command(addOn.Id, new AddOnProductAssignmentDto(p1.Id, AddOnTypeEnum.Extra)), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.ProductAddOns.SingleAsync(l => l.ProductId == p2.Id)).IsActive.ShouldBeFalse();
        (await db.ProductAddOns.SingleAsync(l => l.ProductId == p1.Id)).IsActive.ShouldBeTrue();
        (await db.ProductAddOnPriceOverrides.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Handle_PreviouslyRemovedProductReAdded_ReactivatesLinkAndUpdatesType()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var product = ProductSeed.NewProduct();
        await ProductSeed.SeedAsync(_dbName, addOn, product,
            ProductSeed.NewLink(product.Id, addOn.Id, typeId: (int)AddOnTypeEnum.Extra, isActive: false));

        await Handler().Handle(Command(addOn.Id, new AddOnProductAssignmentDto(product.Id, AddOnTypeEnum.Size)), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        var link = await db.ProductAddOns.SingleAsync();
        link.IsActive.ShouldBeTrue();
        link.AddOnTypeId.ShouldBe((int)AddOnTypeEnum.Size);
    }

    [Fact]
    public async Task Handle_RemovedProduct_DecouplesAddOnFromPendingOrderItemsOnly()
    {
        var addOn = ProductSeed.NewProduct(name: "Shot", code: "S", isAddOn: true);
        var product = ProductSeed.NewProduct();
        var pendingOrder = new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Pending };
        var completedOrder = new Order { Id = Guid.NewGuid(), StatusId = (int)OrderStatusEnum.Completed };
        var pendingParent = new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, ProductId = product.Id, Quantity = 1 };
        var pendingChild = new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, ProductId = addOn.Id, Quantity = 1, ParentOrderItemId = pendingParent.Id };
        var doneParent = new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, ProductId = product.Id, Quantity = 1 };
        var doneChild = new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, ProductId = addOn.Id, Quantity = 1, ParentOrderItemId = doneParent.Id };
        await ProductSeed.SeedAsync(_dbName, addOn, product, ProductSeed.NewLink(product.Id, addOn.Id),
            pendingOrder, completedOrder, pendingParent, pendingChild, doneParent, doneChild);

        await Handler().Handle(Command(addOn.Id), CancellationToken.None);

        await using var db = TestDb.Create(_dbName);
        (await db.OrderItems.SingleAsync(i => i.Id == pendingChild.Id)).ParentOrderItemId.ShouldBeNull();
        (await db.OrderItems.SingleAsync(i => i.Id == doneChild.Id)).ParentOrderItemId.ShouldBe(doneParent.Id);
    }
}
