using MediatR;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Users.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Users;

public record CreateUserCommand(string FirstName, string LastName, string Username, string Password, int RoleId) : IRequest<UserDto>;

public class CreateUserHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService, RolePermissionCache permissionCache) : IRequestHandler<CreateUserCommand, UserDto>
{
    public async Task<UserDto> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        UserValidation.EnsureValidNames(request.FirstName, request.LastName);
        UserValidation.EnsureValidUsername(request.Username);
        UserValidation.EnsureValidPassword(request.Password);
        await UserValidation.EnsureUniqueUsernameAsync(db, request.Username, null, cancellationToken);
        var role = await UserRoleGuard.EnsureAssignableAsync(db, httpContextAccessor.HttpContext!.User, request.RoleId, cancellationToken);

        var user = new User
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            IsActive = true,
            RoleId = role.Id,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        permissionCache.Forget();

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

        return UserMapping.ToDto(user, null, role.Name);
    }
}
