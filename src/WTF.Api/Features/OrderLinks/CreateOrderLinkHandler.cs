using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.OrderLinks;

public record CreateOrderLinkCommand(Guid CustomerId, DateTime? ExpiresAt) : IRequest<OrderLinkDto?>;

public class CreateOrderLinkHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreateOrderLinkCommand, OrderLinkDto?>
{
    public async Task<OrderLinkDto?> Handle(CreateOrderLinkCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == request.CustomerId, cancellationToken);
        if (customer == null)
        {
            return null;
        }

        if (!customer.IsActive)
        {
            throw new InvalidOperationException("Ordering links cannot be created for an inactive customer.");
        }

        if (!customer.AllowOrderingLink)
        {
            throw new InvalidOperationException("Enable ordering for this customer before creating a link.");
        }

        var now = DateTime.UtcNow;
        var expiresAt = request.ExpiresAt?.ToUniversalTime();
        if (expiresAt.HasValue && expiresAt <= now)
        {
            throw new ArgumentException("The end date must be in the future.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var link = new ShortLink
        {
            Id = Guid.NewGuid(),
            Token = OrderLinkToken.Generate(),
            TargetType = OrderLinkToken.TargetType,
            TargetId = customer.Id,
            ExpiresAt = expiresAt,
            CreatedAt = now,
            CreatedBy = userId
        };

        db.ShortLinks.Add(link);
        await db.SaveChangesAsync(cancellationToken);

        // The token is a credential, so the audit entry records the link id only.
        await auditService.LogAsync(
            action: AuditAction.OrderLinkCreated,
            entityType: AuditEntityType.OrderLink,
            entityId: link.Id.ToString(),
            newValues: new { CustomerId = customer.Id, link.ExpiresAt },
            userId: userId,
            cancellationToken: cancellationToken);

        var createdByName = await db.Users
            .Where(u => u.Id == userId)
            .Select(u => u.FirstName + " " + u.LastName)
            .FirstOrDefaultAsync(cancellationToken);

        return new OrderLinkDto(link.Id, link.Token, OrderLinkStatus.Of(link, now), link.CreatedAt,
            createdByName, link.ExpiresAt, link.RevokedAt, link.LastUsedAt);
    }
}
