using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public record UpdateUserCommand(Guid Id, string FirstName, string LastName, string Username, string? Password, UserRoleEnum RoleId) : IRequest<UserDto?>;

public class UpdateUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UpdateUserCommand, UserDto?>
{
    public async Task<UserDto?> Handle(UpdateUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        user.FirstName = request.FirstName;
        user.LastName = request.LastName;
        user.Username = request.Username;
        user.RoleId = (int)request.RoleId;
        user.UpdatedAt = DateTime.UtcNow;
        user.UpdatedBy = userId;

        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
        }

        await db.SaveChangesAsync(cancellationToken);

        return new UserDto(
            user.Id,
            user.FirstName,
            user.LastName,
            user.Username,
            user.IsActive,
            user.CreatedAt,
            user.CreatedBy,
            user.UpdatedAt,
            user.UpdatedBy,
            null,
            (UserRoleEnum)user.RoleId
        );
    }
}
