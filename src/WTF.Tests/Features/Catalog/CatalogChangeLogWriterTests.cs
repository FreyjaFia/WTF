using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Catalog;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Products;
using WTF.Api.Features.Promotions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Features.Products;
using WTF.Tests.Features.Promotions;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Catalog;

public class CatalogChangeLogWriterTests
{
    public sealed record Env(string Db, Guid User, Guid Product, Guid AddOn, Guid Other)
    {
        public WTFDbContext Context() => TestDb.Create(Db);

        public Microsoft.AspNetCore.Http.IHttpContextAccessor Http() => TestRequest.As(User);

        public async Task SeedProductsAsync()
        {
            await using var db = Context();
            await PromotionSeed.SeedProductsAsync(db, User, (Product, "Coffee", false), (Other, "Tea", false), (AddOn, "Milk", true));
        }

        public async Task SeedLinkAsync()
        {
            await SeedProductsAsync();
            await ProductSeed.SeedAsync(Db, ProductSeed.NewLink(Product, AddOn));
        }

        public async Task<Guid> SeedPromotionAsync(int typeId)
        {
            await SeedProductsAsync();
            await using var db = Context();
            var promo = typeId switch
            {
                PromotionTypeIds.FixedBundle => await PromotionSeed.AddBundleAsync(db, Product, 2, 50m),
                PromotionTypeIds.MixMatch => await PromotionSeed.AddMixMatchAsync(db),
                _ => await PromotionSeed.AddDiscountAsync(db, Product, AddOn, 1, 5m, null),
            };
            return promo.Id;
        }
    }

    public sealed record WriteCase(string Name, Func<Env, Task> Run, string EntityType, string Field)
    {
        public override string ToString() => Name;
    }

    public static readonly string[] CoveredCommands =
    [
        nameof(CreateProductCommand),
        nameof(UpdateProductCommand),
        nameof(DeleteProductCommand),
        nameof(RestoreProductCommand),
        nameof(CreateProductAddOnPriceOverrideCommand),
        nameof(UpdateProductAddOnPriceOverrideCommand),
        nameof(DeleteProductAddOnPriceOverrideCommand),
        nameof(CreateDiscountedProductPromotionCommand),
        nameof(UpdateDiscountedProductPromotionCommand),
        nameof(DeleteDiscountedProductPromotionCommand),
        nameof(CreateFixedBundlePromotionCommand),
        nameof(UpdateFixedBundlePromotionCommand),
        nameof(DeleteFixedBundlePromotionCommand),
        nameof(CreateMixMatchPromotionCommand),
        nameof(UpdateMixMatchPromotionCommand),
        nameof(DeleteMixMatchPromotionCommand),
        nameof(RestorePromotionCommand),
        nameof(UpdateBrandCommand),
    ];

    public static TheoryData<WriteCase> Cases() =>
    [
        new("CreateProduct", async e => await new CreateProductHandler(e.Context(), e.Http(), TestFakes.Audit())
            .Handle(new CreateProductCommand { Name = "Latte", Code = "LAT", Price = 90m, Category = CatalogSeed.Drink }, default),
            CatalogEntityTypes.Product, nameof(Product.Price)),

        new("UpdateProduct price", async e =>
        {
            var p = ProductSeed.NewProduct(price: 100m, id: e.Product);
            await ProductSeed.SeedAsync(e.Db, p, ProductSeed.NewUser(e.User));
            await new UpdateProductHandler(e.Context(), e.Http(), TestFakes.Audit())
                .Handle(new UpdateProductCommand { Id = p.Id, Name = p.Name, Code = p.Code, Price = 125m, Category = CatalogSeed.Drink, IsActive = true }, default);
        }, CatalogEntityTypes.Product, nameof(Product.Price)),

        new("UpdateProduct deactivate", async e =>
        {
            var p = ProductSeed.NewProduct(id: e.Product);
            await ProductSeed.SeedAsync(e.Db, p);
            await new UpdateProductHandler(e.Context(), e.Http(), TestFakes.Audit())
                .Handle(new UpdateProductCommand { Id = p.Id, Name = p.Name, Code = p.Code, Price = p.Price, Category = CatalogSeed.Drink, IsActive = false }, default);
        }, CatalogEntityTypes.Product, nameof(Product.IsActive)),

        new("DeleteProduct", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewProduct(id: e.Product));
            await new DeleteProductHandler(e.Context(), e.Http(), TestFakes.Audit()).Handle(new DeleteProductCommand(e.Product), default);
        }, CatalogEntityTypes.Product, nameof(Product.IsActive)),

        new("RestoreProduct", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewProduct(id: e.Product, isActive: false));
            await new RestoreProductHandler(e.Context(), e.Http(), TestFakes.Audit()).Handle(new RestoreProductCommand(e.Product), default);
        }, CatalogEntityTypes.Product, nameof(Product.IsActive)),

        new("CreateProductAddOnPriceOverride", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewLink(e.Product, e.AddOn));
            await new CreateProductAddOnPriceOverrideHandler(e.Context(), e.Http())
                .Handle(new CreateProductAddOnPriceOverrideCommand { ProductId = e.Product, AddOnId = e.AddOn, Price = 7m }, default);
        }, CatalogEntityTypes.AddOnPriceOverride, nameof(ProductAddOnPriceOverride.Price)),

        new("CreateProductAddOnPriceOverride again after delete", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewLink(e.Product, e.AddOn), ProductSeed.NewOverride(e.Product, e.AddOn, 5m, isActive: false));
            await new CreateProductAddOnPriceOverrideHandler(e.Context(), e.Http())
                .Handle(new CreateProductAddOnPriceOverrideCommand { ProductId = e.Product, AddOnId = e.AddOn, Price = 9m }, default);
        }, CatalogEntityTypes.AddOnPriceOverride, nameof(ProductAddOnPriceOverride.IsActive)),

        new("UpdateProductAddOnPriceOverride", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewLink(e.Product, e.AddOn), ProductSeed.NewOverride(e.Product, e.AddOn, 5m));
            await new UpdateProductAddOnPriceOverrideHandler(e.Context(), e.Http())
                .Handle(new UpdateProductAddOnPriceOverrideCommand { ProductId = e.Product, AddOnId = e.AddOn, Price = 6m }, default);
        }, CatalogEntityTypes.AddOnPriceOverride, nameof(ProductAddOnPriceOverride.Price)),

        new("DeleteProductAddOnPriceOverride", async e =>
        {
            await ProductSeed.SeedAsync(e.Db, ProductSeed.NewOverride(e.Product, e.AddOn, 5m));
            await new DeleteProductAddOnPriceOverrideHandler(e.Context(), e.Http())
                .Handle(new DeleteProductAddOnPriceOverrideCommand(e.Product, e.AddOn), default);
        }, CatalogEntityTypes.AddOnPriceOverride, nameof(ProductAddOnPriceOverride.IsActive)),

        new("CreateDiscountedProductPromotion", async e =>
        {
            await e.SeedProductsAsync();
            await new CreateDiscountedProductPromotionHandler(e.Context(), e.Http()).Handle(new CreateDiscountedProductPromotionCommand
            {
                Name = "Half",
                Items = [new CreateDiscountedProductItemRequestDto(e.Product, null, 50m, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, CatalogHistoryRules.CreatedField),

        new("UpdateDiscountedProductPromotion discount value", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.DiscountedProduct);
            await new UpdateDiscountedProductPromotionHandler(e.Context(), e.Http()).Handle(new UpdateDiscountedProductPromotionCommand
            {
                PromotionId = id,
                Name = "Half",
                Items = [new CreateDiscountedProductItemRequestDto(e.Product, 8m, null, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, "Rule:"),

        new("DeleteDiscountedProductPromotion", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.DiscountedProduct);
            await new DeleteDiscountedProductPromotionHandler(e.Context(), e.Http()).Handle(new DeleteDiscountedProductPromotionCommand(id), default);
        }, CatalogEntityTypes.Promotion, nameof(Promotion.IsActive)),

        new("CreateFixedBundlePromotion", async e =>
        {
            await e.SeedProductsAsync();
            await new CreateFixedBundlePromotionHandler(e.Context(), e.Http()).Handle(new CreateFixedBundlePromotionCommand
            {
                Name = "Two",
                BundlePrice = 150m,
                Items = [new CreateFixedBundlePromotionItemRequestDto(e.Product, 2, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, "BundlePrice"),

        new("UpdateFixedBundlePromotion price", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.FixedBundle);
            await new UpdateFixedBundlePromotionHandler(e.Context(), e.Http()).Handle(new UpdateFixedBundlePromotionCommand
            {
                PromotionId = id,
                Name = "Two",
                BundlePrice = 40m,
                Items = [new CreateFixedBundlePromotionItemRequestDto(e.Product, 2, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, "BundlePrice"),

        new("DeleteFixedBundlePromotion", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.FixedBundle);
            await new DeleteFixedBundlePromotionHandler(e.Context(), e.Http()).Handle(new DeleteFixedBundlePromotionCommand(id), default);
        }, CatalogEntityTypes.Promotion, nameof(Promotion.IsActive)),

        new("CreateMixMatchPromotion", async e =>
        {
            await e.SeedProductsAsync();
            await new CreateMixMatchPromotionHandler(e.Context(), e.Http()).Handle(new CreateMixMatchPromotionCommand
            {
                Name = "Any 2",
                RequiredQuantity = 2,
                BundlePrice = 15m,
                Items = [new CreateMixMatchItemRequestDto(e.Product, []), new CreateMixMatchItemRequestDto(e.Other, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, "RequiredQuantity"),

        new("UpdateMixMatchPromotion limit", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.MixMatch);
            await new UpdateMixMatchPromotionHandler(e.Context(), e.Http()).Handle(new UpdateMixMatchPromotionCommand
            {
                PromotionId = id,
                Name = "Any 2",
                RequiredQuantity = 2,
                BundlePrice = 15m,
                Schedule = new PromotionScheduleRequest(null, null, null, 25, 2),
                Items = [new CreateMixMatchItemRequestDto(e.Product, []), new CreateMixMatchItemRequestDto(e.Other, [])],
            }, default);
        }, CatalogEntityTypes.Promotion, nameof(Promotion.MaxRedemptions)),

        new("DeleteMixMatchPromotion", async e =>
        {
            var id = await e.SeedPromotionAsync(PromotionTypeIds.MixMatch);
            await new DeleteMixMatchPromotionHandler(e.Context(), e.Http()).Handle(new DeleteMixMatchPromotionCommand(id), default);
        }, CatalogEntityTypes.Promotion, nameof(Promotion.IsActive)),

        new("RestorePromotion", async e =>
        {
            await e.SeedProductsAsync();
            await using var db = e.Context();
            var promo = await PromotionSeed.AddMixMatchAsync(db, isActive: false);
            await new RestorePromotionHandler(e.Context(), e.Http()).Handle(new RestorePromotionCommand(promo.Id), default);
        }, CatalogEntityTypes.Promotion, nameof(Promotion.IsActive)),

        new("UpdateBrand tax settings", async e =>
        {
            var tenant = new FixedTenant(Guid.NewGuid());
            var brand = BrandDefaults.For("Shop") with { SeniorPwdEnabled = true, VatRegistered = true };
            await new UpdateBrandHandler(TestDb.Create(e.Db, tenant), tenant, TestFakes.Audit(), e.Http()).Handle(new UpdateBrandCommand(brand), default);
        }, CatalogEntityTypes.TenantSettings, nameof(TenantSetting.SeniorPwdEnabled)),
    ];

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task EveryCatalogWritePath_LeavesALogRow(WriteCase writeCase)
    {
        var env = new Env(TestDb.NewName(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        await writeCase.Run(env);

        await using var db = env.Context();
        var rows = await db.CatalogChangeLogs.Where(l => l.EntityType == writeCase.EntityType).ToListAsync();
        rows.ShouldContain(l => l.Field.StartsWith(writeCase.Field), $"{writeCase.Name} wrote no {writeCase.EntityType}.{writeCase.Field} row");
        rows.ShouldAllBe(l => l.ChangedBy == env.User);
    }

    [Fact]
    public void EveryMutatingCommandOfTheCatalogFeatures_IsCoveredOrKnownNotToChangeCatalogFields()
    {
        string[] notCatalogFields =
        [
            "UploadProductImageCommand", "RemoveProductImageCommand", "AssignProductAddOnsCommand", "AssignAddOnProductsCommand",
            "SetProductAddOnDefaultCommand", "UploadPromotionImageCommand", "RemovePromotionImageCommand",
            "UploadBrandLogoCommand", "RemoveBrandLogoCommand",
        ];
        string[] features = ["WTF.Api.Features.Products", "WTF.Api.Features.Promotions", "WTF.Api.Features.Branding"];

        var commands = typeof(CatalogEntityTypes).Assembly.GetTypes()
            .Where(t => t.Name.EndsWith("Command") && features.Contains(t.Namespace))
            .Select(t => t.Name)
            .ToList();

        var unclassified = commands.Except(CoveredCommands).Except(notCatalogFields).ToList();

        unclassified.ShouldBeEmpty("A command that writes catalog fields needs the change log and a row in this test's table.");
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }
}
