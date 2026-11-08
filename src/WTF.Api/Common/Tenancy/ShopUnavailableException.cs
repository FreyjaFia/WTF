namespace WTF.Api.Common.Tenancy;

public sealed class ShopUnavailableException(string shopName, string? phone) : Exception(Message)
{
    public const string Message = "This shop can't take orders right now.";

    public string ShopName { get; } = shopName;

    public string? Phone { get; } = phone;
}
