using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Orders;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Orders;

public class SeniorPwdReasonsTests
{
    [Fact]
    public void Ineligible_EligibleLine_HasNoReason()
    {
        SeniorPwdReasons.Ineligible("Latte", true, false, false).ShouldBeNull();
    }

    [Theory]
    [InlineData(false, false, false, "Latte is not food or drink, so it cannot take the Senior/PWD discount.")]
    [InlineData(true, false, true, "Latte is part of a bundle, so it cannot take the Senior/PWD discount.")]
    [InlineData(true, true, false, "Latte already has a promotion price, so it cannot take the Senior/PWD discount.")]
    public void Ineligible_GivesOneMessage(bool eligible, bool promotion, bool bundle, string expected)
    {
        SeniorPwdReasons.Ineligible("Latte", eligible, promotion, bundle).ShouldBe(expected);
    }

    [Fact]
    public async Task LoadSeniorPwdAsync_NoSettingsRow_MeansOffAndNotVatRegistered()
    {
        await using var db = TestDb.Create(TestDb.NewName());

        var settings = await TenantSettingsLookup.LoadSeniorPwdAsync(db, CancellationToken.None);

        settings.ShouldBe(new SeniorPwdSettings(false, false));
    }

    [Fact]
    public async Task LoadSeniorPwdAsync_ReadsTheShopSettings()
    {
        var name = TestDb.NewName();
        await using (var db = TestDb.Create(name))
        {
            db.TenantSettings.Add(new TenantSetting
            {
                TenantId = Guid.NewGuid(), ShopName = "Shop", PrimaryColor = "#fff", TimeZone = "Asia/Manila",
                CurrencySymbol = "P", CurrencyCode = "PHP", CurrencyDecimals = 2, SeniorPwdEnabled = true, VatRegistered = true,
            });
            await db.SaveChangesAsync();
        }

        await using var read = TestDb.Create(name);
        (await TenantSettingsLookup.LoadSeniorPwdAsync(read, CancellationToken.None)).ShouldBe(new SeniorPwdSettings(true, true));
    }
}
