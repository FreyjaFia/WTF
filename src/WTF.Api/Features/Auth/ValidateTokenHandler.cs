using MediatR;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using WTF.Api.Features.Auth.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

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

        // The JWT handler maps the inbound "sub" claim to NameIdentifier, so check both.
        var userIdClaim = (principal.FindFirst(ClaimTypes.NameIdentifier)
            ?? principal.FindFirst(JwtRegisteredClaimNames.Sub))?.Value;

        if (!Guid.TryParse(userIdClaim, out var userId))
        {
            return new ValidateTokenDto(false);
        }

        var user = await db.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, cancellationToken);

        var tokenTenant = principal.FindFirst(TenantDefaults.ClaimType)?.Value;
        if (user is not null && tokenTenant is not null && !string.Equals(tokenTenant, user.TenantId.ToString(), StringComparison.OrdinalIgnoreCase))
        {
            return new ValidateTokenDto(false);
        }

        if (user is null)
        {
            return new ValidateTokenDto(false);
        }

        return new ValidateTokenDto(true);
    }
}
