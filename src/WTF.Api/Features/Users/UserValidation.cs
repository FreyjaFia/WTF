using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

internal static class UserValidation
{
    public static void EnsureValidUsername(string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            throw new InvalidOperationException("Username is required.");
        }
    }

    /// <summary>
    /// Rejects a username already used by another user, ignoring case and including deactivated users (restoring one
    /// must not create a duplicate). The database has no unique index on Users.Username, so this check is the guard.
    /// </summary>
    public static async Task EnsureUniqueUsernameAsync(
        WTFDbContext db,
        string username,
        Guid? excludeUserId,
        CancellationToken cancellationToken)
    {
        var normalized = username.Trim().ToLower();
        var taken = await db.Users.AnyAsync(
            u => u.Username.ToLower() == normalized && (!excludeUserId.HasValue || u.Id != excludeUserId.Value),
            cancellationToken);

        if (taken)
        {
            throw new InvalidOperationException("Username already exists.");
        }
    }

    public static void EnsureValidPassword(string? password, bool isUpdate = false)
    {
        if (!isUpdate && string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException("Password is required.");
        }
    }
}
