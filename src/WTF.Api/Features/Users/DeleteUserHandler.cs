using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record DeleteUserCommand(Guid Id) : IRequest<bool>;

public class DeleteUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<DeleteUserCommand, bool>
{
    public async Task<bool> Handle(DeleteUserCommand request, CancellationToken cancellationToken)
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

        db.Users.Remove(user);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UserDeleted,
            entityType: AuditEntityType.User,
            entityId: request.Id.ToString(),
            oldValues: oldValues,
            userId: actorUserId,
            cancellationToken: cancellationToken);

        return true;
    }
}
