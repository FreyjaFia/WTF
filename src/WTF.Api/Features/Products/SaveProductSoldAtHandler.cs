using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record SaveProductSoldAtCommand(Guid ProductId, bool IsAllBranches, List<Guid>? BranchIds) : IRequest<ProductSoldAtDto?>;

public class SaveProductSoldAtHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SaveProductSoldAtCommand, ProductSoldAtDto?>
{
    public async Task<ProductSoldAtDto?> Handle(SaveProductSoldAtCommand request, CancellationToken cancellationToken)
    {
        var user = httpContextAccessor.HttpContext!.User;
        if (!await db.Products.AnyAsync(p => p.Id == request.ProductId, cancellationToken))
        {
            return null;
        }

        await ProductWriteScope.EnsureMayChangeAsync(db, user, request.ProductId, cancellationToken);

        var wanted = request.IsAllBranches ? [] : (request.BranchIds ?? []).Distinct().ToList();
        if (request.IsAllBranches && !ProductWriteScope.IsShopWide(db, user))
        {
            throw new ForbiddenActionException(ProductWriteScope.EverywhereMessage);
        }

        if (!request.IsAllBranches)
        {
            await ProductSoldAtRules.EnsureValidAsync(db, wanted, cancellationToken);
        }

        var userId = user.GetUserId();
        var existing = await db.ProductBranches.Where(p => p.ProductId == request.ProductId).ToListAsync(cancellationToken);
        var before = existing.Select(e => e.BranchId).OrderBy(b => b).ToList();

        db.ProductBranches.RemoveRange(existing.Where(e => !wanted.Contains(e.BranchId)));
        foreach (var branchId in wanted.Where(w => existing.All(e => e.BranchId != w)))
        {
            db.ProductBranches.Add(new ProductBranch
            {
                ProductId = request.ProductId,
                BranchId = branchId,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId
            });
        }

        if (!before.SequenceEqual(wanted.OrderBy(b => b)))
        {
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync(
                action: AuditAction.ProductUpdated,
                entityType: AuditEntityType.Product,
                entityId: request.ProductId.ToString(),
                oldValues: new { SoldAtBranchIds = before },
                newValues: new { SoldAtBranchIds = wanted },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return await ProductSoldAtLoader.LoadAsync(db, user, request.ProductId, cancellationToken);
    }
}

internal static class ProductSoldAtRules
{
    public static async Task EnsureValidAsync(WTFDbContext db, List<Guid> branchIds, CancellationToken cancellationToken)
    {
        if (branchIds.Count == 0)
        {
            throw new InvalidOperationException("Pick at least one branch, or sell the product at every branch.");
        }

        var shopBranchIds = await BranchRules.AllOfShop(db)
            .Where(b => b.IsActive)
            .Select(b => b.Id)
            .ToListAsync(cancellationToken);
        if (branchIds.Any(id => !shopBranchIds.Contains(id)))
        {
            throw new InvalidOperationException("One or more branches were not found.");
        }

        if (db.IsBranchLimited && branchIds.Any(id => !db.AllowedBranchIds.Contains(id)))
        {
            throw new ForbiddenActionException("You can only sell a product at the branches you work in.");
        }
    }
}
