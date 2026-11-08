using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Auth.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record PlatformLoginCommand(string Username, string Password) : IRequest<LoginDto?>;

public class PlatformLoginHandler(
    WTFDbContext db,
    IJwtService jwtService,
    IPlatformAuditService audit,
    IConfiguration config,
    TimeProvider clock) : IRequestHandler<PlatformLoginCommand, LoginDto?>
{
    public const int MaxFailedAttempts = 5;

    public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    public const int TokenMinutes = 60;

    public async Task<LoginDto?> Handle(PlatformLoginCommand request, CancellationToken cancellationToken)
    {
        var username = request.Username?.Trim() ?? string.Empty;
        var admin = await db.PlatformAdmins.FirstOrDefaultAsync(a => a.Username == username && a.IsActive, cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;

        if (admin is null)
        {
            // Spend the same time as a real check so the answer does not show whether the name exists.
            BCrypt.Net.BCrypt.Verify(request.Password ?? string.Empty, DummyHash);
            await audit.LogAsync(PlatformActions.LoginFailed, details: $"Unknown name '{Truncate(username)}'", cancellationToken: cancellationToken);
            return null;
        }

        if (admin.LockedUntil is { } lockedUntil && lockedUntil > now)
        {
            await audit.LogAsync(PlatformActions.LoginLocked, platformAdminId: admin.Id, username: admin.Username, cancellationToken: cancellationToken);
            return null;
        }

        if (!BCrypt.Net.BCrypt.Verify(request.Password ?? string.Empty, admin.PasswordHash))
        {
            admin.FailedAttempts++;
            if (admin.FailedAttempts >= MaxFailedAttempts)
            {
                admin.LockedUntil = now.Add(LockDuration);
                admin.FailedAttempts = 0;
            }

            await db.SaveChangesAsync(cancellationToken);
            await audit.LogAsync(PlatformActions.LoginFailed, platformAdminId: admin.Id, username: admin.Username, cancellationToken: cancellationToken);
            return null;
        }

        admin.FailedAttempts = 0;
        admin.LockedUntil = null;
        admin.LastLoginAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.LogAsync(PlatformActions.Login, platformAdminId: admin.Id, username: admin.Username, cancellationToken: cancellationToken);

        return new LoginDto(jwtService.GeneratePlatformToken(admin, TokenMinutes), string.Empty, now.AddMinutes(TokenMinutes));
    }

    private static string Truncate(string value) => value.Length > 50 ? value[..50] : value;

    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword("not-a-real-password");
}
