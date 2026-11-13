using System.Text.RegularExpressions;

namespace WTF.Api.Features.Customers;

internal static class CustomerValidation
{
    public const int MaxContactLength = 30;
    public const int MaxNameLength = 50;
    public const int MaxAddressLength = 300;

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

    public static string? NormalizeAddress(string? address)
    {
        var trimmed = address?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > MaxAddressLength)
        {
            throw new InvalidOperationException($"An address can be at most {MaxAddressLength} characters.");
        }

        return trimmed;
    }

    public static string? NormalizeLastName(string? lastName)
    {
        var trimmed = lastName?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    public static void EnsureValidNames(string firstName, string? lastName)
    {
        if (string.IsNullOrWhiteSpace(firstName))
        {
            throw new InvalidOperationException("Customer first name is required.");
        }

        if (firstName.Length > MaxNameLength || (lastName?.Length ?? 0) > MaxNameLength)
        {
            throw new InvalidOperationException($"Customer names can be at most {MaxNameLength} characters.");
        }
    }
}
