using WTF.Api.Features.Items;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Items;

public class ItemValidationUniqueTests
{
    private readonly string _db = TestDb.NewName();

    private Task Validate(string? sku, string? barcode, Guid? currentId = null)
    {
        using var db = TestDb.Create(_db);
        return ItemValidation.ValidateUniqueSkuAndBarcode(db, sku, barcode, currentId, CancellationToken.None);
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_DuplicateSku_Throws()
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, sku: "SKU-1");
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Validate("SKU-1", null));
        ex.Message.ShouldBe("Item SKU already exists.");
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_DuplicateBarcode_Throws()
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, barcode: "123");
        var ex = await Should.ThrowAsync<InvalidOperationException>(() => Validate(null, "123"));
        ex.Message.ShouldBe("Item barcode already exists.");
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_SkuWithPadding_IsTrimmedBeforeComparing()
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, sku: "SKU-1");
        await Should.ThrowAsync<InvalidOperationException>(() => Validate("  SKU-1  ", null));
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_SameItemExcluded_DoesNotThrow()
    {
        var u = await ItemSeed.User(_db);
        var item = await ItemSeed.Item(_db, u.Id, sku: "SKU-1", barcode: "123");
        await Validate("SKU-1", "123", item.Id);
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_OtherItemHasSku_ThrowsEvenWhenCurrentIdGiven()
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, sku: "SKU-1");
        var mine = await ItemSeed.Item(_db, u.Id, name: "Mine");
        await Should.ThrowAsync<InvalidOperationException>(() => Validate("SKU-1", null, mine.Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ValidateUniqueSkuAndBarcode_BlankValues_AreIgnored(string? blank)
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, sku: null, barcode: null);
        await Validate(blank, blank);
    }

    [Fact]
    public async Task ValidateUniqueSkuAndBarcode_NoMatches_DoesNotThrow()
    {
        var u = await ItemSeed.User(_db);
        await ItemSeed.Item(_db, u.Id, sku: "A", barcode: "1");
        await Validate("B", "2");
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("  x ", "x")]
    [InlineData("", null)]
    public void NormalizeOptional_Value_ReturnsTrimmedOrNull(string? input, string? expected) =>
        ItemValidation.NormalizeOptional(input).ShouldBe(expected);
}
