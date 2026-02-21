using MediatR;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public record CreateUserCommand(string FirstName, string LastName, string Username, string Password, UserRoleEnum RoleId) : IRequest<UserDto>;

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
