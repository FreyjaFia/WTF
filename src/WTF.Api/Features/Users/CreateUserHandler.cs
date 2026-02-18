using MediatR;
using WTF.Contracts.Users;
using WTF.Contracts.Users.Commands;
using WTF.Contracts.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public class CreateUserHandler(WTFDbContext db) : IRequestHandler<CreateUserCommand, UserDto>
{
    public async Task<UserDto> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        var user = new User
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            IsActive = true,
            RoleId = (int)request.RoleId
        };

        db.Users.Add(user);
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
