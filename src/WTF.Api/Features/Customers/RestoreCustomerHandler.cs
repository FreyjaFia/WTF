using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public record RestoreCustomerCommand(Guid Id) : IRequest<bool>;

public class RestoreCustomerHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<RestoreCustomerCommand, bool>
{
    public async Task<bool> Handle(RestoreCustomerCommand request, CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .FirstOrDefaultAsync(c => c.Id == request.Id, cancellationToken);

        if (customer == null)
        {
            return false;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new
        {
            customer.FirstName,
            customer.LastName,
            customer.Address,
            customer.IsActive
        };

        customer.IsActive = true;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.CustomerRestored,
            entityType: AuditEntityType.Customer,
            entityId: customer.Id.ToString(),
            oldValues: oldValues,
            newValues: new
            {
                customer.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
