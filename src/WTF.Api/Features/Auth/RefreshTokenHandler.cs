using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Services;
using WTF.Contracts.Auth;
using WTF.Contracts.Auth.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Auth;

public class RefreshTokenHandler(WTFDbContext db, IJwtService jwtService, IConfiguration configuration) : IRequestHandler<RefreshTokenCommand, LoginDto?>
{
    public async Task<LoginDto?> Handle(RefreshTokenCommand request, CancellationToken cancellationToken)
    {
        var refreshToken = await db.RefreshTokens
            .Include(rt => rt.User)
            .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken, cancellationToken);

        if (refreshToken is null || refreshToken.IsRevoked || refreshToken.ExpiresAt < DateTime.UtcNow)
        {
            return null;
        }

        refreshToken.IsRevoked = true;

        var accessToken = jwtService.GenerateAccessToken(refreshToken.User);
        var newRefreshToken = jwtService.GenerateRefreshToken();

        var refreshTokenExpiration = DateTime.UtcNow.AddDays(int.Parse(configuration["Jwt:RefreshTokenExpirationDays"] ?? "7"));

        var newRefreshTokenEntity = new RefreshToken
        {
            UserId = refreshToken.UserId,
            Token = newRefreshToken,
            ExpiresAt = refreshTokenExpiration,
            CreatedAt = DateTime.UtcNow,
            IsRevoked = false
        };

        db.RefreshTokens.Add(newRefreshTokenEntity);
        await db.SaveChangesAsync(cancellationToken);

        return new LoginDto(
            accessToken,
            newRefreshToken,
            DateTime.UtcNow.AddMinutes(int.Parse(configuration["Jwt:AccessTokenExpirationMinutes"] ?? "60"))
        );
    }
}
