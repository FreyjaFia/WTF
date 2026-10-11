using Microsoft.AspNetCore.Http;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Sync;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Sync;

public class GetPosCatalogHandlerTests
{
    private readonly string _db = TestDb.NewName();
    private readonly Guid _userId = Guid.NewGuid();

    private async Task<Product> AddProduct(string name, bool active = true, bool addOn = false, decimal price = 100, string? imageUrl = null)
    {
        await using var db = TestDb.Create(_db);
        var p = new Product
        {
            Id = Guid.NewGuid(), Name = name, Code = name[..3].ToUpperInvariant(), Price = price, CategoryId = 1,
            IsActive = active, IsAddOn = addOn, CreatedAt = DateTime.UtcNow, CreatedBy = _userId
        };
        db.Products.Add(p);
        if (imageUrl is not null)
        {
            var imageId = Guid.NewGuid();
            db.Images.Add(new Image { ImageId = imageId, ImageUrl = imageUrl, UploadedAt = DateTime.UtcNow });
            db.ProductImages.Add(new ProductImage { ProductId = p.Id, ImageId = imageId });
        }
        await db.SaveChangesAsync();
        return p;
    }

    private async Task AddAddOn(Guid productId, Guid addOnId, int? typeId, bool active = true, decimal? overridePrice = null, bool overrideActive = true)
    {
        await using var db = TestDb.Create(_db);
        db.ProductAddOns.Add(new ProductAddOn { ProductId = productId, AddOnId = addOnId, AddOnTypeId = typeId, IsActive = active });
        if (overridePrice.HasValue)
        {
            db.ProductAddOnPriceOverrides.Add(new ProductAddOnPriceOverride
            {
                Id = Guid.NewGuid(), ProductId = productId, AddOnId = addOnId, Price = overridePrice.Value,
                IsActive = overrideActive, CreatedAt = DateTime.UtcNow
            });
        }
        await db.SaveChangesAsync();
    }

    private async Task AddCustomer(string first, string last, bool active = true)
    {
        await using var db = TestDb.Create(_db);
        db.Customers.Add(new Customer
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = last, IsActive = active, CreatedAt = DateTime.UtcNow, CreatedBy = _userId
        });
        await db.SaveChangesAsync();
    }

    private Task<WTF.Api.Features.Sync.DTOs.PosCatalogDto> Run(Microsoft.AspNetCore.Http.IHttpContextAccessor? accessor = null) =>
        new GetPosCatalogHandler(TestDb.Create(_db), accessor ?? TestRequest.None())
            .Handle(new GetPosCatalogQuery(), CancellationToken.None);

    [Fact]
    public async Task Handle_Products_OnlyActiveNonAddOnsOrderedByName()
    {
        await AddProduct("Mocha");
        await AddProduct("Americano");
        await AddProduct("Retired", active: false);
        await AddProduct("Extra shot", addOn: true);

        var catalog = await Run();

        catalog.Products.Select(p => p.Name).ShouldBe(["Americano", "Mocha"]);
    }

    [Fact]
    public async Task Handle_Customers_OnlyActiveOrderedByFirstThenLastName()
    {
        await AddCustomer("Zed", "A");
        await AddCustomer("Ana", "Zulu");
        await AddCustomer("Ana", "Bell");
        await AddCustomer("Gone", "Away", active: false);

        var catalog = await Run();

        catalog.Customers.Select(c => $"{c.FirstName} {c.LastName}").ShouldBe(["Ana Bell", "Ana Zulu", "Zed A"]);
    }

    [Fact]
    public async Task Handle_ProductWithActiveAddOns_ReportsAddOnCount()
    {
        var latte = await AddProduct("Latte");
        var shot = await AddProduct("Shot", addOn: true);
        var syrup = await AddProduct("Syrup", addOn: true);
        var off = await AddProduct("Whip", addOn: true);
        await AddAddOn(latte.Id, shot.Id, (int)AddOnTypeEnum.Extra);
        await AddAddOn(latte.Id, syrup.Id, (int)AddOnTypeEnum.Flavor);
        await AddAddOn(latte.Id, off.Id, (int)AddOnTypeEnum.Extra, active: false);

        var catalog = await Run();

        catalog.Products.Single().AddOnCount.ShouldBe(2);
    }

    [Fact]
    public async Task Handle_AddOns_GroupedByTypeAndOrderedByType()
    {
        var latte = await AddProduct("Latte");
        var vanilla = await AddProduct("Vanilla", addOn: true);
        var shot = await AddProduct("Shot", addOn: true);
        var large = await AddProduct("Large", addOn: true);
        await AddAddOn(latte.Id, vanilla.Id, (int)AddOnTypeEnum.Flavor);
        await AddAddOn(latte.Id, shot.Id, (int)AddOnTypeEnum.Extra);
        await AddAddOn(latte.Id, large.Id, (int)AddOnTypeEnum.Size);

        var groups = (await Run()).AddOnsByProductId[latte.Id];

        groups.Select(g => g.Type).ShouldBe([AddOnTypeEnum.Size, AddOnTypeEnum.Flavor, AddOnTypeEnum.Extra]);
        groups.Select(g => g.DisplayName).ShouldBe(["Size", "Flavor", "Extra"]);
        groups[0].Options.Single().Name.ShouldBe("Large");
    }

    [Fact]
    public async Task Handle_AddOnWithoutType_DefaultsToExtra()
    {
        var latte = await AddProduct("Latte");
        var shot = await AddProduct("Shot", addOn: true);
        await AddAddOn(latte.Id, shot.Id, typeId: null);

        (await Run()).AddOnsByProductId[latte.Id].Single().Type.ShouldBe(AddOnTypeEnum.Extra);
    }

    [Fact]
    public async Task Handle_InactiveAddOnProduct_IsLeftOut()
    {
        var latte = await AddProduct("Latte");
        var shot = await AddProduct("Shot", active: false, addOn: true);
        await AddAddOn(latte.Id, shot.Id, (int)AddOnTypeEnum.Extra);

        (await Run()).AddOnsByProductId.ShouldNotContainKey(latte.Id);
    }

    [Fact]
    public async Task Handle_ActiveOverridePrice_IsReturnedAndInactiveOverrideIgnored()
    {
        var latte = await AddProduct("Latte");
        var shot = await AddProduct("Shot", addOn: true, price: 30);
        var syrup = await AddProduct("Syrup", addOn: true, price: 20);
        await AddAddOn(latte.Id, shot.Id, (int)AddOnTypeEnum.Extra, overridePrice: 10);
        await AddAddOn(latte.Id, syrup.Id, (int)AddOnTypeEnum.Extra, overridePrice: 5, overrideActive: false);

        var options = (await Run()).AddOnsByProductId[latte.Id].Single().Options;

        options.Single(o => o.Name == "Shot").OverridePrice.ShouldBe(10m);
        options.Single(o => o.Name == "Shot").EffectivePrice.ShouldBe(10m);
        options.Single(o => o.Name == "Syrup").OverridePrice.ShouldBeNull();
        options.Single(o => o.Name == "Syrup").EffectivePrice.ShouldBe(20m);
    }

    [Fact]
    public async Task Handle_AddOnOfInactiveOrAddOnProduct_IsNotReturnedForThatKey()
    {
        // Add-ons are only loaded for catalog (non add-on, active) products.
        var latte = await AddProduct("Latte", active: false);
        var shot = await AddProduct("Shot", addOn: true);
        await AddAddOn(latte.Id, shot.Id, (int)AddOnTypeEnum.Extra);

        (await Run()).AddOnsByProductId.ShouldBeEmpty();
    }

    [Fact]
    public async Task Handle_RelativeImageUrl_BecomesAbsoluteUsingRequestHost()
    {
        await AddProduct("Latte", imageUrl: "/images/latte.png");
        var accessor = TestRequest.As(_userId);
        accessor.HttpContext!.Request.Scheme = "https";
        accessor.HttpContext.Request.Host = new HostString("pos.example.com");

        (await Run(accessor)).Products.Single().ImageUrl.ShouldBe("https://pos.example.com/images/latte.png");
    }

    [Fact]
    public async Task Handle_AbsoluteImageUrl_IsKeptAsIs()
    {
        await AddProduct("Latte", imageUrl: "https://cdn.example.com/latte.png");

        (await Run()).Products.Single().ImageUrl.ShouldBe("https://cdn.example.com/latte.png");
    }

    [Fact]
    public async Task Handle_ProductWithoutImage_HasNullImageUrl()
    {
        await AddProduct("Latte");

        (await Run()).Products.Single().ImageUrl.ShouldBeNull();
    }

    [Fact]
    public async Task Handle_EmptyDatabase_ReturnsEmptyCatalogStamped()
    {
        var before = DateTime.UtcNow;
        var catalog = await Run();

        catalog.Products.ShouldBeEmpty();
        catalog.Customers.ShouldBeEmpty();
        catalog.AddOnsByProductId.ShouldBeEmpty();
        catalog.SyncedAt.ShouldBeGreaterThanOrEqualTo(before);
    }
}
