using WTF.Domain.Entities;

namespace WTF.Api.Features.OrderLinks;

public static class OrderLinkStatus
{
    public const string Active = "Active";
    public const string Expired = "Expired";
    public const string Revoked = "Revoked";

    /// <summary>Revoked wins over expired, so a link revoked before its end date reads Revoked.</summary>
    public static string Of(ShortLink link, DateTime nowUtc)
    {
        if (link.RevokedAt.HasValue)
        {
            return Revoked;
        }

        return link.ExpiresAt.HasValue && link.ExpiresAt <= nowUtc ? Expired : Active;
    }
}
