using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record SetSuppliesCostCommand(
    Guid ProductId,
    [property: Range(0, 9999.99)] decimal Amount) : IRequest<bool>;

public class SetSuppliesCostHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetSuppliesCostCommand, bool>
{
    public async Task<bool> Handle(SetSuppliesCostCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);
        if (product is null)
        {
            return false;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldAmount = product.SuppliesCost;
        var amount = CostRules.Round(request.Amount);

        product.SuppliesCost = amount;
        product.UpdatedAt = DateTime.UtcNow;
        product.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductUpdated,
            AuditEntityType.Product,
            product.Id.ToString(),
            oldValues: new { SuppliesCost = oldAmount },
            newValues: new { SuppliesCost = amount },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
