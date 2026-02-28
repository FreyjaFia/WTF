using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record UpdateMeCommand(string Password) : IRequest<bool>;

public class UpdateMeHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<UpdateMeCommand, bool>
{
    public async Task<bool> Handle(UpdateMeCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user == null)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return false;
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UserPasswordChanged,
            entityType: AuditEntityType.User,
            entityId: user.Id.ToString(),
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
