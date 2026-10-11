using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

internal static class SessionRevocation
{
    /// <summary>
    /// Revokes every active refresh token of a user so other sessions end when the password changes.
    /// Does not save; the caller saves together with the password change.
    /// </summary>
    public static async Task RevokeRefreshTokensAsync(WTFDbContext db, Guid userId, CancellationToken cancellationToken)
    {
        var active = await db.RefreshTokens
            .Where(token => token.UserId == userId && !token.IsRevoked)
            .ToListAsync(cancellationToken);

        foreach (var token in active)
        {
            token.IsRevoked = true;
        }
    }
}
