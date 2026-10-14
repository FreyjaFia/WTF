using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record ChangePasswordCommand : IRequest<bool>
{
    [Required] public string CurrentPassword { get; init; } = string.Empty;
    [Required][MinLength(8)] public string NewPassword { get; init; } = string.Empty;
}

public class ChangePasswordHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<ChangePasswordCommand, bool>
{
    public const int MinPasswordLength = 8;

    public async Task<bool> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        // The [MinLength] on the command only applies when a request is bound, so enforce it here as well.
        if (request.NewPassword.Length < MinPasswordLength)
        {
            throw new InvalidOperationException($"New password must be at least {MinPasswordLength} characters.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (user == null)
        {
            return false;
        }

        // Verify current password
        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
        {
            return false;
        }

        // Hash and set new password
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);

        // End every other session: a stolen refresh token must not survive a password change.
        await SessionRevocation.RevokeRefreshTokensAsync(db, userId, cancellationToken);

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
