using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record RevokeOrderLinkCommand(Guid CustomerId, Guid LinkId) : IRequest<bool>;

public class RevokeOrderLinkHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<RevokeOrderLinkCommand, bool>
{
    public async Task<bool> Handle(RevokeOrderLinkCommand request, CancellationToken cancellationToken)
    {
        var link = await db.ShortLinks.FirstOrDefaultAsync(
            l => l.Id == request.LinkId
                 && l.TargetType == OrderLinkToken.TargetType
                 && l.TargetId == request.CustomerId,
            cancellationToken);

        if (link == null)
        {
            return false;
        }

        // Revoking twice is harmless: keep the first revoke time and do not audit again.
        if (link.RevokedAt.HasValue)
        {
            return true;
        }

        link.RevokedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.OrderLinkRevoked,
            entityType: AuditEntityType.OrderLink,
            entityId: link.Id.ToString(),
            newValues: new { request.CustomerId, link.RevokedAt },
            userId: httpContextAccessor.HttpContext!.User.GetUserId(),
            cancellationToken: cancellationToken);

        return true;
    }
}
