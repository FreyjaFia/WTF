using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record ResetTenantUserPasswordCommand(Guid TenantId, Guid UserId) : IRequest<PasswordResetDto>;

// The new password is shown once to the platform admin; it is never stored in clear and never written to a log.
public class ResetTenantUserPasswordHandler(WTFDbContext db, IPlatformAuditService audit) : IRequestHandler<ResetTenantUserPasswordCommand, PasswordResetDto>
{
    public async Task<PasswordResetDto> Handle(ResetTenantUserPasswordCommand request, CancellationToken cancellationToken)
    {
        db.UseTenant(request.TenantId);

        var user = await db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == request.UserId && u.TenantId == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("User not found in this shop.");

        if (user.Username.StartsWith(Features.OrderLinks.SubmitPublicOrderHandler.SystemUsername, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("That is a system account.");
        }

        var password = TemporaryPassword.Generate();
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
        user.MustChangePassword = true;
        user.UpdatedAt = DateTime.UtcNow;

        var tokens = await db.RefreshTokens.IgnoreQueryFilters()
            .Where(t => t.UserId == user.Id && !t.IsRevoked)
            .ToListAsync(cancellationToken);
        foreach (var token in tokens)
        {
            token.IsRevoked = true;
        }

        await db.SaveChangesAsync(cancellationToken);
        await audit.LogAsync(PlatformActions.PasswordReset, request.TenantId, $"Password reset for user '{user.Username}'; their sessions were ended.", cancellationToken: cancellationToken);

        return new PasswordResetDto(user.Username, password);
    }
}
