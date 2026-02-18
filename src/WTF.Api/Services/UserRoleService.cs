using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Services;

public interface IUserRoleService
{
    Task<string> GetRoleNameAsync(Guid userId, CancellationToken cancellationToken);
}

public class UserRoleService(WTFDbContext db) : IUserRoleService
{
    public async Task<string> GetRoleNameAsync(Guid userId, CancellationToken cancellationToken)
    {
        var role = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.Role != null ? u.Role.Name : null)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(role))
        {
            throw new InvalidOperationException($"Role is not configured for user '{userId}'.");
        }

        return role;
    }
}
