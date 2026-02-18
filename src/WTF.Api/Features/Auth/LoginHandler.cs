using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Services;
using WTF.Contracts.Auth;
using WTF.Contracts.Auth.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Auth;

public class LoginHandler(WTFDbContext db, IJwtService jwtService, IUserRoleService userRoleService, IConfiguration config) : IRequestHandler<LoginCommand, LoginDto>
{
    public async Task<LoginDto> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .Include(u => u.UserImage)
                .ThenInclude(ui => ui!.Image)
            .FirstOrDefaultAsync(u => u.Username == request.Username, cancellationToken);

        if (user == null)
        {
            return null!;
        }

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            return null!;
        }

        var role = await userRoleService.GetRoleNameAsync(user.Id, cancellationToken);
        var accessToken = jwtService.GenerateAccessToken(user, role);
        var refreshToken = jwtService.GenerateRefreshToken();

        var refreshTokenExpiration = DateTime.UtcNow.AddDays(int.Parse(config["Jwt:RefreshTokenExpirationDays"] ?? "7"));

        var refreshTokenEntity = new RefreshToken
        {
            UserId = user.Id,
            Token = refreshToken,
            ExpiresAt = refreshTokenExpiration,
            CreatedAt = DateTime.UtcNow,
            IsRevoked = false
        };

        db.RefreshTokens.Add(refreshTokenEntity);
        await db.SaveChangesAsync(cancellationToken);

        return new LoginDto(
            accessToken,
            refreshToken,
            DateTime.UtcNow.AddMinutes(int.Parse(config["Jwt:AccessTokenExpirationMinutes"] ?? "60"))
        );
    }
}
