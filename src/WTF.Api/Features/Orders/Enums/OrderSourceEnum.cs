namespace WTF.Api.Features.Orders.Enums;

/// <summary>Where an order came from (<c>Orders.Source</c>).</summary>
public enum OrderSourceEnum : byte
{
    Pos = 0,
    CustomerLink = 1
}

/// <summary>How a customer link order is handed over (<c>Orders.FulfillmentType</c>); null for POS orders.</summary>
public enum FulfillmentTypeEnum : byte
{
    Pickup = 0,
    Delivery = 1
}
