using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using WTF.Api.Common.Auth;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Services
{
    public interface IJwtService
    {
        string GenerateAccessToken(User user, string role);
        string GeneratePlatformToken(PlatformAdmin admin, int minutes);
        string GenerateImpersonationToken(User user, string role, Guid platformAdminId, string platformUsername, bool readOnly, int minutes);
        string GenerateRefreshToken();
        ClaimsPrincipal? ValidateToken(string token);
        Guid? GetUserIdFromToken(string token);
    }

    public class JwtService(IConfiguration configuration, IHttpContextAccessor httpContextAccessor) : IJwtService
    {
        private readonly string _secretKey = configuration["Jwt:SecretKey"] ?? throw new InvalidOperationException("JWT SecretKey not configured");
        private readonly string _issuer = configuration["Jwt:Issuer"] ?? throw new InvalidOperationException("JWT Issuer not configured");
        private readonly string _audience = configuration["Jwt:Audience"] ?? throw new InvalidOperationException("JWT Audience not configured");
        private readonly int _accessTokenExpirationMinutes = int.Parse(configuration["Jwt:AccessTokenExpirationMinutes"] ?? "60");
        private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;

        public string GenerateAccessToken(User user, string role)
        {
            var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secretKey));
            var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new(JwtRegisteredClaimNames.UniqueName, user.Username),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new(ClaimTypes.Role, role),
                new("role", role)
            };

            if (user.TenantId != Guid.Empty)
            {
                claims.Add(new Claim(TenantDefaults.ClaimType, user.TenantId.ToString()));
            }

            var token = new JwtSecurityToken(
                issuer: _issuer,
                audience: _audience,
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(_accessTokenExpirationMinutes),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public string GeneratePlatformToken(PlatformAdmin admin, int minutes)
        {
            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, admin.Id.ToString()),
                new(JwtRegisteredClaimNames.UniqueName, admin.Username),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new(ClaimTypes.Role, AppRoles.PlatformAdmin),
                new("role", AppRoles.PlatformAdmin)
            };

            return WriteToken(claims, minutes);
        }

        public string GenerateImpersonationToken(User user, string role, Guid platformAdminId, string platformUsername, bool readOnly, int minutes)
        {
            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new(JwtRegisteredClaimNames.UniqueName, user.Username),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new(ClaimTypes.Role, role),
                new("role", role),
                new(TenantDefaults.ClaimType, user.TenantId.ToString()),
                new(ImpersonationClaims.By, platformAdminId.ToString()),
                new(ImpersonationClaims.ByName, platformUsername),
                new(ImpersonationClaims.ReadOnly, readOnly ? "1" : "0")
            };

            return WriteToken(claims, minutes);
        }

        private string WriteToken(IEnumerable<Claim> claims, int minutes)
        {
            var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secretKey));
            var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);
            var token = new JwtSecurityToken(
                issuer: _issuer,
                audience: _audience,
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(minutes),
                signingCredentials: credentials);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public string GenerateRefreshToken()
        {
            var randomNumber = new byte[32];
            using var rng = RandomNumberGenerator.Create();
            rng.GetBytes(randomNumber);
            return Convert.ToBase64String(randomNumber);
        }

        public ClaimsPrincipal? ValidateToken(string token)
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = Encoding.UTF8.GetBytes(_secretKey);

            try
            {
                var principal = tokenHandler.ValidateToken(token, new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ValidateIssuer = true,
                    ValidIssuer = _issuer,
                    ValidateAudience = true,
                    ValidAudience = _audience,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero
                }, out SecurityToken validatedToken);

                return principal;
            }
            catch
            {
                return null;
            }
        }

        public Guid? GetUserIdFromToken(string token)
        {
            var principal = ValidateToken(token);
            // The handler maps "sub" to NameIdentifier on inbound tokens, so check both.
            var userIdClaim = (principal?.FindFirst(ClaimTypes.NameIdentifier)
                ?? principal?.FindFirst(JwtRegisteredClaimNames.Sub))?.Value;

            if (Guid.TryParse(userIdClaim, out var userId))
            {
                return userId;
            }

            return null;
        }
    }
}
