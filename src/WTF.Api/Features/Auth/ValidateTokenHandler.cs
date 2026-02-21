using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Auth.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public record ValidateTokenQuery(string Token) : IRequest<ValidateTokenDto>;

public class ValidateTokenHandler(WTFDbContext db, IJwtService jwtService) : IRequestHandler<ValidateTokenQuery, ValidateTokenDto>
{
    public async Task<ValidateTokenDto> Handle(ValidateTokenQuery request, CancellationToken cancellationToken)
    {
        var principal = jwtService.ValidateToken(request.Token);

        if (principal is null)
        {
            return new ValidateTokenDto(false);
        }

        var userIdClaim = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;

        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return new ValidateTokenDto(false);
        }

        var user = await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (user is null)
        {
            return new ValidateTokenDto(false);
        }

        return new ValidateTokenDto(true);
    }
}