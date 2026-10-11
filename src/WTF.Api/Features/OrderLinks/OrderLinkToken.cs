using System.Security.Cryptography;

namespace WTF.Api.Features.OrderLinks;

/// <summary>Shared values and the token generator for customer ordering links.</summary>
public static class OrderLinkToken
{
    /// <summary><see cref="WTF.Domain.Entities.ShortLink.TargetType"/> of a customer ordering link.</summary>
    public const string TargetType = "CustomerOrder";

    private const int ByteLength = 32;

    /// <summary>32 random bytes as base64url (43 characters, URL safe). Never log the result.</summary>
    public static string Generate()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(ByteLength))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
