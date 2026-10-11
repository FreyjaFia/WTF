using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record UpdateMeCommand(string Password, string? CurrentPassword = null) : IRequest<bool>;

public class UpdateMeHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<UpdateMeCommand, bool>
{
    public async Task<bool> Handle(UpdateMeCommand request, CancellationToken cancellationToken)
    {
        // Same rule as ChangePassword: a new password is at least 8 characters.
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < ChangePasswordHandler.MinPasswordLength)
        {
            throw new InvalidOperationException($"New password must be at least {ChangePasswordHandler.MinPasswordLength} characters.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user == null)
        {
            return false;
        }

        // A stolen access token alone must not be enough to take over the account.
        if (string.IsNullOrEmpty(request.CurrentPassword) || !BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
        {
            throw new InvalidOperationException("Current password is incorrect.");
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

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
