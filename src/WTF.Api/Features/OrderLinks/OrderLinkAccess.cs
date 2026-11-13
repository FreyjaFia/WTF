using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.OrderLinks;

/// <summary>The link and customer behind a token that passed <see cref="OrderLinkAccess.ResolveAsync"/>.</summary>
public sealed record OrderLinkAccessResult(ShortLink Link, Customer Customer);

/// <summary>
/// The one check every public ordering route runs. A token is valid only when it exists, is a customer ordering
/// link, is not revoked or expired, and its customer is active and still allowed to order. Every failure returns
/// null, so callers answer with the same 404 and never reveal whether a token ever existed.
/// The one exception is a valid link of a suspended or lapsed shop: that throws <see cref="ShopUnavailableException"/>,
/// answered with a 503 and the shop's contact.
/// </summary>
public static class OrderLinkAccess
{
    public static async Task<OrderLinkAccessResult?> ResolveAsync(
        WTFDbContext db, string? token, CancellationToken cancellationToken, DateTime? nowUtc = null, string? alsoRequires = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 64)
        {
            return null;
        }

        var link = await db.ShortLinks
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
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

        // The link is a global secret; the tenant comes from the link row, never from the visitor.
        db.UseTenant(link.TenantId);

        // A suspended, cancelled or lapsed shop takes no orders from its customer page.
        // A shop whose plan has no order links takes no orders either; the link stays valid for when the plan returns.
        if (db.TenantFilterEnabled
            && (!await TenantAccess.IsActiveAsync(db, link.TenantId, cancellationToken)
                || await SubscriptionStateLoader.IsLockedAsync(db, link.TenantId, now, cancellationToken)
                || !(await TenantPlanLookup.LoadAsync(db, link.TenantId, cancellationToken)).Features.Contains("orderlinks")))
        {
            var brand = await BrandDefaults.LoadAsync(db, link.TenantId, cancellationToken);
            throw new ShopUnavailableException(brand.ShopName, brand.Phone);
        }

        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == link.TargetId.Value, cancellationToken);
        if (customer == null || !customer.IsActive || !customer.AllowOrderingLink)
        {
            return null;
        }

        // A part of the page that belongs to another feature (the chat) answers "not found" when that feature is off.
        if (alsoRequires != null && db.TenantFilterEnabled
            && !(await TenantPlanLookup.LoadAsync(db, link.TenantId, cancellationToken)).Features.Contains(alsoRequires))
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
