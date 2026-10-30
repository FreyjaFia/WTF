using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory;

public record SetRecipeMultiplierCommand(
    Guid ProductId,
    [property: Range(0.01, 10)] decimal Multiplier) : IRequest<bool>;

public class SetRecipeMultiplierHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetRecipeMultiplierCommand, bool>
{
    public async Task<bool> Handle(SetRecipeMultiplierCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);
        if (product is null)
        {
            return false;
        }

        if (!product.IsAddOn)
        {
            throw new InvalidOperationException("Only an add-on, such as a size, can scale a recipe.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldMultiplier = product.RecipeMultiplier;
        var multiplier = Math.Round(request.Multiplier, 3, MidpointRounding.AwayFromZero);

        product.RecipeMultiplier = multiplier;
        product.UpdatedAt = DateTime.UtcNow;
        product.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductUpdated,
            AuditEntityType.Product,
            product.Id.ToString(),
            oldValues: new { RecipeMultiplier = oldMultiplier },
            newValues: new { RecipeMultiplier = multiplier },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }
}
