using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record GetOrderLinksQuery(Guid CustomerId) : IRequest<List<OrderLinkDto>?>;

public class GetOrderLinksHandler(WTFDbContext db) : IRequestHandler<GetOrderLinksQuery, List<OrderLinkDto>?>
{
    public async Task<List<OrderLinkDto>?> Handle(GetOrderLinksQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Customers.AnyAsync(c => c.Id == request.CustomerId, cancellationToken))
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var links = await db.ShortLinks
            .Where(l => l.TargetType == OrderLinkToken.TargetType && l.TargetId == request.CustomerId)
            .Include(l => l.CreatedByNavigation)
            .OrderByDescending(l => l.CreatedAt)
            .ToListAsync(cancellationToken);

        // How many orders each link has produced, whatever became of them.
        var linkIds = links.Select(l => l.Id).ToList();
        var counts = await db.Orders
            .Where(o => o.OrderLinkId != null && linkIds.Contains(o.OrderLinkId.Value))
            .GroupBy(o => o.OrderLinkId!.Value)
            .Select(g => new { LinkId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.LinkId, x => x.Count, cancellationToken);

        return links
            .Select(l => new OrderLinkDto(
                l.Id,
                l.Token,
                OrderLinkStatus.Of(l, now),
                l.CreatedAt,
                l.CreatedByNavigation == null
                    ? null
                    : $"{l.CreatedByNavigation.FirstName} {l.CreatedByNavigation.LastName}",
                l.ExpiresAt,
                l.RevokedAt,
                l.LastUsedAt,
                counts.GetValueOrDefault(l.Id)))
            .ToList();
    }
}
