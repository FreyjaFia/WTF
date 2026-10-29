using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Orders;

internal static class PickOneAddOnRule
{
    public static void Ensure(IEnumerable<OrderItemRequestDto> addOns, IEnumerable<(Guid AddOnId, AddOnTypeEnum Type)> types)
    {
        var pickOneIds = types
            .Where(add => add.Type is AddOnTypeEnum.Size or AddOnTypeEnum.Flavor or AddOnTypeEnum.Sauce)
            .Select(add => add.AddOnId)
            .ToHashSet();

        if (addOns.Any(addOn => pickOneIds.Contains(addOn.ProductId) && addOn.Quantity != 1))
        {
            throw new InvalidOperationException("A size, flavor or sauce can only be chosen once.");
        }
    }
}
