using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;

namespace WTF.Tests.Infrastructure;

internal static class SeniorPwdTestKit
{
    public static SeniorPwdPersonRequestDto Person(string id = "SC-123456", string name = "Lola Remedios", SeniorPwdTypeEnum type = SeniorPwdTypeEnum.Senior, bool idChecked = false) =>
        new(type, id, name, idChecked);

    public static OrderItemRequestDto Covered(Guid productId, int quantity = 1, int person = 0, params OrderItemRequestDto[] addOns) =>
        new(productId, quantity, [.. addOns], null, null, SeniorPwdPersonIndex: person);

    public static OrderItemRequestDto Plain(Guid productId, int quantity = 1, params OrderItemRequestDto[] addOns) =>
        new(productId, quantity, [.. addOns], null, null);

    public static CreateOrderCommand Sale(
        IEnumerable<OrderItemRequestDto> items,
        IEnumerable<SeniorPwdPersonRequestDto> persons,
        decimal? expectedTotal = null,
        OrderStatusEnum status = OrderStatusEnum.Completed) =>
        new() { Status = status, Items = [.. items], SeniorPwdPersons = [.. persons], ExpectedTotal = expectedTotal };

    public static async Task ConfigureShopAsync(string dbName, bool enabled = true, bool vatRegistered = false)
    {
        await using var db = TestDb.Create(dbName);
        db.TenantSettings.RemoveRange(db.TenantSettings);
        db.TenantSettings.Add(new TenantSetting
        {
            TenantId = Guid.NewGuid(),
            ShopName = "Shop",
            PrimaryColor = "#6f4e37",
            TimeZone = "Asia/Manila",
            CurrencySymbol = "P",
            CurrencyCode = "PHP",
            CurrencyDecimals = 2,
            SeniorPwdEnabled = enabled,
            VatRegistered = vatRegistered,
        });
        await db.SaveChangesAsync();
    }
}
