using MediatR;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using WTF.Contracts.Auth.Login;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth.Login;

public class LoginHandler(WTFDbContext db, IConfiguration config) : IRequestHandler<LoginCommand, LoginDto>
{
    public Task<LoginDto> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var isValidUser = db.Users.Any(u => u.Username == request.Username && u.Password == request.Password);

        if (!isValidUser)
        {
            return null;
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, request.Username),
            new Claim(ClaimTypes.Role, "User")
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials
        );

        return Task.FromResult(new LoginDto(
            new JwtSecurityTokenHandler().WriteToken(token)
        ));
    }
}