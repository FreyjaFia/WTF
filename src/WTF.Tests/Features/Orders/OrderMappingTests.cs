using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;

namespace WTF.Tests.Features.Orders;

public class OrderMappingTests
{
    private static Order SampleOrder() => new()
    {
        Id = Guid.NewGuid(),
        OrderNumber = 7,
        Source = (byte)OrderSourceEnum.CustomerLink,
        FulfillmentType = (byte)FulfillmentTypeEnum.Delivery,
        DeliveryAddress = "1 Main St",
        CustomerAddress = "2 Side St",
        StatusId = (int)OrderStatusEnum.Pending,
    };

    private static OrderSeniorPwdDiscount Row() => new()
    {
        Id = Guid.NewGuid(),
        Type = (byte)SeniorPwdTypeEnum.Senior,
        IdNumber = "SC123456",
        CustomerName = "Lola",
    };

    [Fact]
    public void ToDto_CopiesTheOrderFieldsEveryHandlerNeeds()
    {
        var dto = OrderMapping.ToDto(SampleOrder(), [], 10m, [], [], maskIds: false);

        dto.OrderNumber.ShouldBe(7);
        dto.Source.ShouldBe(OrderSourceEnum.CustomerLink);
        dto.FulfillmentType.ShouldBe(FulfillmentTypeEnum.Delivery);
        dto.DeliveryAddress.ShouldBe("1 Main St");
        dto.CustomerAddress.ShouldBe("2 Side St");
        dto.TotalAmount.ShouldBe(10m);
        dto.SeniorPwdPersons.ShouldBeNull();
    }

    [Theory]
    [InlineData(true, "****3456")]
    [InlineData(false, "SC123456")]
    public void ToDto_MasksTheIdOnlyWhenAsked(bool mask, string expected)
    {
        var dto = OrderMapping.ToDto(SampleOrder(), [], 0m, [], [Row()], mask);

        dto.SeniorPwdPersons.ShouldHaveSingleItem().IdNumber.ShouldBe(expected);
    }
}
