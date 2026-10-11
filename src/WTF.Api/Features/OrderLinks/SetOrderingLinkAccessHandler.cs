using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record SetOrderingLinkAccessCommand(Guid CustomerId, bool Allow) : IRequest<OrderingLinkAccessDto?>;

public class SetOrderingLinkAccessHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetOrderingLinkAccessCommand, OrderingLinkAccessDto?>
{
    public async Task<OrderingLinkAccessDto?> Handle(SetOrderingLinkAccessCommand request,
        CancellationToken cancellationToken)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == request.CustomerId, cancellationToken);
        if (customer == null)
        {
            return null;
        }

        if (request.Allow && !customer.IsActive)
        {
            throw new InvalidOperationException("Ordering links cannot be enabled for an inactive customer.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        var revoked = 0;

        if (customer.AllowOrderingLink != request.Allow)
        {
            customer.AllowOrderingLink = request.Allow;
            customer.UpdatedAt = now;
            customer.UpdatedBy = userId;

            // Disabling ordering makes every link of the customer stop working right away.
            if (!request.Allow)
            {
                var links = await db.ShortLinks
                    .Where(l => l.TargetType == OrderLinkToken.TargetType
                                && l.TargetId == customer.Id
                                && l.RevokedAt == null)
                    .ToListAsync(cancellationToken);

                foreach (var link in links)
                {
                    link.RevokedAt = now;
                }

                revoked = links.Count;
            }

            await db.SaveChangesAsync(cancellationToken);

            await auditService.LogAsync(
                action: request.Allow ? AuditAction.OrderLinkEnabled : AuditAction.OrderLinkDisabled,
                entityType: AuditEntityType.Customer,
                entityId: customer.Id.ToString(),
                oldValues: new { AllowOrderingLink = !request.Allow },
                newValues: new { AllowOrderingLink = request.Allow, RevokedLinks = revoked },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return new OrderingLinkAccessDto(customer.AllowOrderingLink, revoked);
    }
}
