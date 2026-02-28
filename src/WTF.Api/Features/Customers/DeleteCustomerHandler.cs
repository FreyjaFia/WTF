using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Customers;

public record DeleteCustomerCommand(Guid Id) : IRequest<bool>;

public class DeleteCustomerHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService) : IRequestHandler<DeleteCustomerCommand, bool>
{
    public async Task<bool> Handle(DeleteCustomerCommand request, CancellationToken cancellationToken)
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

        customer.IsActive = false;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.CustomerDeleted,
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
