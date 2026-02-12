using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Auth.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Auth;

public class LogoutHandler(WTFDbContext db) : IRequestHandler<LogoutCommand, bool>
{
    public async Task<bool> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        var refreshToken = await db.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken, cancellationToken);

        if (refreshToken is null)
        {
            return false;
        }

        refreshToken.IsRevoked = true;
        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
