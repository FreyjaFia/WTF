using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record LogoutCommand(string RefreshToken) : IRequest<bool>;

public class LogoutHandler(WTFDbContext db, IAuditService auditService) : IRequestHandler<LogoutCommand, bool>
{
    public async Task<bool> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        var refreshToken = await db.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken, cancellationToken);

        if (refreshToken is null)
        {
            return false;
        }

        refreshToken.IsRevoked = true;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UserLogout,
            entityType: AuditEntityType.User,
            entityId: refreshToken.UserId.ToString(),
            userId: refreshToken.UserId,
            cancellationToken: cancellationToken);

        return true;
    }
}
