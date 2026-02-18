using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Users;
using WTF.Contracts.Users.Commands;
using WTF.Contracts.Users.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public class UpdateUserHandler(WTFDbContext db) : IRequestHandler<UpdateUserCommand, UserDto?>
{
    public async Task<UserDto?> Handle(UpdateUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return null;
        }

        user.FirstName = request.FirstName;
        user.LastName = request.LastName;
        user.Username = request.Username;
        user.RoleId = (int)request.RoleId;

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
            null,
            (UserRoleEnum)user.RoleId
        );
    }
}
