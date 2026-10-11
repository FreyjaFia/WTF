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
        WTFDbContext db, string? token, CancellationToken cancellationToken, DateTime? nowUtc = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
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
            || (link.ExpiresAt.HasValue && link.ExpiresAt <= now)
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

    /// <summary>
    /// Asks the database again, right now, whether this link may still be used. Call it immediately before an action
    /// is finalized: a link revoked, expired or switched off after the first check (while the customer filled in a
    /// form, or while the request was being validated) must not still go through.
    ///
    /// It deliberately projects to a yes/no instead of loading the link again: EF Core keeps the values of an entity it
    /// already tracks and does not refresh them from a second query, which would make a re-check of the same
    /// <see cref="ShortLink"/> instance always agree with the first one.
    /// </summary>
    public static Task<bool> IsStillValidAsync(
        WTFDbContext db, Guid linkId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        return db.ShortLinks
            .AsNoTracking()
            .Where(l => l.Id == linkId
                        && l.TargetType == OrderLinkToken.TargetType
                        && l.RevokedAt == null
                        && (l.ExpiresAt == null || l.ExpiresAt > nowUtc))
            .AnyAsync(l => db.Customers.Any(c =>
                c.Id == l.TargetId && c.IsActive && c.AllowOrderingLink), cancellationToken);
    }
}
