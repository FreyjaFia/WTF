using WTF.Api.Common.Auth;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Hubs;

namespace WTF.Tests.Common;

public class EnumAndConstantConsistencyTests
{
    [Fact]
    public void UserRoleEnum_NamesMatchAppRoles()
    {
        var roleNames = typeof(AppRoles).GetFields()
            .Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!).OrderBy(x => x);

        Enum.GetNames<UserRoleEnum>().OrderBy(x => x).ShouldBe(roleNames);
    }

    [Theory]
    [InlineData(UserRoleEnum.Admin, 1)]
    [InlineData(UserRoleEnum.Cashier, 2)]
    [InlineData(UserRoleEnum.AdminViewer, 3)]
    [InlineData(UserRoleEnum.SuperAdmin, 4)]
    [InlineData(UserRoleEnum.ItemManager, 5)]
    [InlineData(UserRoleEnum.StockManager, 6)]
    public void UserRoleEnum_ValuesMatchDatabaseIds(UserRoleEnum role, int id)
    {
        ((int)role).ShouldBe(id);
    }

    [Fact]
    public void PromotionTypeIds_AreDistinctDatabaseIds()
    {
        PromotionTypeIds.FixedBundle.ShouldBe(1);
        PromotionTypeIds.MixMatch.ShouldBe(2);
        PromotionTypeIds.DiscountedProduct.ShouldBe(3);
    }

    [Fact]
    public void OrderStatusEnum_Values()
    {
        ((int)OrderStatusEnum.All).ShouldBe(0);
        ((int)OrderStatusEnum.Pending).ShouldBe(1);
        ((int)OrderStatusEnum.Completed).ShouldBe(2);
        ((int)OrderStatusEnum.Cancelled).ShouldBe(3);
        ((int)OrderStatusEnum.Refunded).ShouldBe(4);
        ((int)OrderStatusEnum.PendingApproval).ShouldBe(5);
    }

    [Fact]
    public void PaymentMethodEnum_Values()
    {
        ((int)PaymentMethodEnum.Cash).ShouldBe(1);
        ((int)PaymentMethodEnum.GCash).ShouldBe(2);
    }

    [Fact]
    public void ProductEnums_Values()
    {
        ((int)ProductCategoryEnum.Drink).ShouldBe(1);
        ((int)ProductCategoryEnum.Other).ShouldBe(4);
        ((int)ProductSubCategoryEnum.Coffee).ShouldBe(1);
        ((int)ProductSubCategoryEnum.Retail).ShouldBe(4);
        ((int)AddOnTypeEnum.Size).ShouldBe(1);
        ((int)AddOnTypeEnum.Sauce).ShouldBe(5);
    }

    [Fact]
    public void AppPolicies_ConstantsEqualTheirNames()
    {
        var fields = typeof(AppPolicies).GetFields().Where(f => f.IsLiteral).ToList();

        fields.ShouldNotBeEmpty();
        foreach (var f in fields)
        {
            f.GetRawConstantValue().ShouldBe(f.Name);
        }
    }

    [Fact]
    public void AppRoles_ConstantsEqualTheirNames()
    {
        foreach (var f in typeof(AppRoles).GetFields().Where(f => f.IsLiteral))
        {
            f.GetRawConstantValue().ShouldBe(f.Name);
        }
    }

    [Fact]
    public void AuditEnums_NamesAreUniqueAndNonEmpty()
    {
        var names = Enum.GetNames<AuditAction>();
        names.Distinct().Count().ShouldBe(names.Length);
        Enum.GetNames<AuditEntityType>().ShouldNotBeEmpty();
    }

    [Fact]
    public void HubNames_Values()
    {
        HubNames.Groups.DashboardViewers.ShouldBe("DashboardViewers");
        HubNames.Events.DashboardUpdated.ShouldBe("DashboardUpdated");
        HubNames.Events.OrderUpdated.ShouldBe("OrderUpdated");
    }
}
