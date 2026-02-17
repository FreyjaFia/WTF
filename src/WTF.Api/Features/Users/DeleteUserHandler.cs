using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Users.Commands;
using WTF.Domain.Data;

namespace WTF.Api.Features.Users;

public class DeleteUserHandler(WTFDbContext db) : IRequestHandler<DeleteUserCommand, bool>
{
    public async Task<bool> Handle(DeleteUserCommand request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.Id, cancellationToken);
        if (user == null)
        {
            return false;
        }

        db.Users.Remove(user);
        await db.SaveChangesAsync(cancellationToken);
        
        return true;
    }
}