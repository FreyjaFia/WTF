using WTF.Api.Features.Products;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Products;

public class ProductMappingTests
{
    [Theory]
    [InlineData("abc", "ABC")]
    [InlineData("  ab-1 ", "AB-1")]
    [InlineData("MiXeD", "MIXED")]
    public void NormalizeCode_TrimsAndUppercases(string input, string expected)
    {
        ProductMapping.NormalizeCode(input).ShouldBe(expected);
        ProductValidation.NormalizeCode(input).ShouldBe(expected);
    }

    [Fact]
    public void ToDto_MapsFieldsAndDefaults()
    {
        var product = new Product
        {
            Id = Guid.NewGuid(),
            Name = "Latte",
            Code = "LAT",
            Price = 120m,
            CategoryId = 1,
            SubCategoryId = null,
            IsActive = true
        };

        var dto = ProductMapping.ToDto(product, null, []);

        dto.Name.ShouldBe("Latte");
        dto.Code.ShouldBe("LAT");
        dto.Price.ShouldBe(120m);
        dto.SubCategory.ShouldBeNull();
        dto.AddOnCount.ShouldBe(0);
        dto.OverridePrice.ShouldBeNull();
        dto.PriceHistory.ShouldBeEmpty();
    }

    [Fact]
    public void ToDto_WithSubCategoryAndOverride_MapsThem()
    {
        var product = new Product { Name = "Shot", Code = "SH", Price = 10m, CategoryId = 1, SubCategoryId = 1, IsAddOn = true };
        List<ProductPriceHistoryDto> history = [];

        var dto = ProductMapping.ToDto(product, "img", history, addOnCount: 3, overridePrice: 5m);

        dto.SubCategory.ShouldBe((ProductSubCategoryEnum)1);
        dto.AddOnCount.ShouldBe(3);
        dto.OverridePrice.ShouldBe(5m);
        dto.ImageUrl.ShouldBe("img");
        dto.IsAddOn.ShouldBeTrue();
    }

    [Fact]
    public void ProductDto_EffectivePrice_PrefersOverride()
    {
        var withOverride = new ProductDto(Guid.NewGuid(), "A", "A", null, 10m, (ProductCategoryEnum)1, null, true, true,
            DateTime.UtcNow, Guid.NewGuid(), null, null, null, [], 0, 4m);
        var withoutOverride = withOverride with { OverridePrice = null };

        withOverride.EffectivePrice.ShouldBe(4m);
        withOverride.HasOverridePrice.ShouldBeTrue();
        withoutOverride.EffectivePrice.ShouldBe(10m);
        withoutOverride.HasOverridePrice.ShouldBeFalse();
    }

    [Fact]
    public void ProductDto_ProductCategory_ReflectsAddOnFlag()
    {
        var dto = new ProductDto(Guid.NewGuid(), "A", "A", null, 10m, (ProductCategoryEnum)1, null, false, true,
            DateTime.UtcNow, Guid.NewGuid(), null, null, null, []);

        dto.ProductCategory.ShouldBe("Main Product");
        (dto with { IsAddOn = true }).ProductCategory.ShouldBe("Add-on");
    }
}
