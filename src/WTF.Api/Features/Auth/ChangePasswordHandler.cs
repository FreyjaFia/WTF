using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record ChangePasswordCommand : IRequest<bool>
{
    [Required] public string CurrentPassword { get; init; } = string.Empty;
    [Required][MinLength(8)] public string NewPassword { get; init; } = string.Empty;
}

public class ChangePasswordHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<ChangePasswordCommand, bool>
{
    public async Task<bool> Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
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

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
