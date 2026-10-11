using System.Text.RegularExpressions;

namespace WTF.Api.Features.Customers;

internal static class CustomerValidation
{
    public const int MaxContactLength = 30;

    private static readonly Regex ContactPattern = new(@"^[0-9+()\-\s]+$", RegexOptions.Compiled);

    /// <summary>
    /// The optional contact number, trimmed; blank means none. Same rules as the number a customer gives when ordering
    /// through their link, so a saved number can always be used there.
    /// </summary>
    public static string? NormalizeContactNumber(string? contactNumber)
    {
        var contact = contactNumber?.Trim();
        if (string.IsNullOrEmpty(contact))
        {
            return null;
        }

        if (contact.Length > MaxContactLength
            || !ContactPattern.IsMatch(contact)
            || contact.Count(char.IsDigit) < 7)
        {
            throw new InvalidOperationException("Please enter a valid contact number.");
        }

        return contact;
    }

    public static void EnsureValidNames(string firstName, string lastName)
    {
        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
        {
            throw new InvalidOperationException("Customer first name and last name are required.");
        }
    }
}
