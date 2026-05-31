namespace WTF.Api.Features.Customers;

internal static class CustomerValidation
{
    public static void EnsureValidNames(string firstName, string lastName)
    {
        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
        {
            throw new InvalidOperationException("Customer first name and last name are required.");
        }
    }
}
