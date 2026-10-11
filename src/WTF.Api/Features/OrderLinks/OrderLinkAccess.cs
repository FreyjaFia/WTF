using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.OrderLinks;

/// <summary>The link and customer behind a token that passed <see cref="OrderLinkAccess.ResolveAsync"/>.</summary>
public sealed record OrderLinkAccessResult(ShortLink Link, Customer Customer);

/// <summary>
/// The one check every public ordering route runs. A token is valid only when it exists, is a customer ordering
/// link, is not revoked or expired, and its customer is active and still allowed to order. Every failure returns
/// null, so callers answer with the same 404 and never reveal whether a token ever existed.
/// </summary>
public static class OrderLinkAccess
{
    public static async Task<OrderLinkAccessResult?> ResolveAsync(
        WTFDbContext db, string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 64)
        {
            return null;
        }

        var link = await db.ShortLinks.FirstOrDefaultAsync(
            l => l.Token == token && l.TargetType == OrderLinkToken.TargetType,
            cancellationToken);

        // SQL Server compares text without regard to case by default, but tokens are case sensitive.
        if (link == null
            || !string.Equals(link.Token, token, StringComparison.Ordinal)
            || link.RevokedAt.HasValue
            || (link.ExpiresAt.HasValue && link.ExpiresAt <= DateTime.UtcNow)
            || !link.TargetId.HasValue)
        {
            return null;
        }

        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == link.TargetId.Value, cancellationToken);
        if (customer == null || !customer.IsActive || !customer.AllowOrderingLink)
        {
            return null;
        }

        return new OrderLinkAccessResult(link, customer);
    }
}
