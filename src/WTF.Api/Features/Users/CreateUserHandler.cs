using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public record CreateUserCommand(string FirstName, string LastName, string Username, string Password, UserRoleEnum RoleId) : IRequest<UserDto>;

public class CreateUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<CreateUserCommand, UserDto>
{
    public async Task<UserDto> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var user = new User
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            IsActive = true,
            RoleId = (int)request.RoleId,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.UserCreated,
            entityType: AuditEntityType.User,
            entityId: user.Id.ToString(),
            newValues: new
            {
                user.FirstName,
                user.LastName,
                user.Username,
                user.RoleId,
                user.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

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
