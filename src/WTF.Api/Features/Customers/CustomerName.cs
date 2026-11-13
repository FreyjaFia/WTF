namespace WTF.Api.Features.Customers;

internal static class CustomerName
{
    public static string Join(string? firstName, string? lastName)
    {
        return string.Join(' ', new[] { firstName, lastName }.Where(part => !string.IsNullOrWhiteSpace(part)).Select(part => part!.Trim()));
    }
}
