using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record RestoreUserCommand(Guid Id) : IRequest<bool>;

public class RestoreUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<RestoreUserCommand, bool>
{
    public async Task<bool> Handle(RestoreUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return false;
        }

        var actorUserId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            user.FirstName,
            user.LastName,
            user.Username,
            user.RoleId,
            user.IsActive
        };

        user.IsActive = true;
        user.UpdatedAt = DateTime.UtcNow;
        user.UpdatedBy = actorUserId;

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UserRestored,
            entityType: AuditEntityType.User,
            entityId: request.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                user.IsActive
            },
            userId: actorUserId,
            cancellationToken: cancellationToken);

        return true;
    }
}
