using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Catalog;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record SaveProductBranchPricesCommand(Guid ProductId, List<ProductBranchPriceInputDto> Branches) : IRequest<ProductBranchPricesDto?>;

public class SaveProductBranchPricesHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SaveProductBranchPricesCommand, ProductBranchPricesDto?>
{
    private const decimal MinPrice = 0.01m;
    private const decimal MaxPrice = 999999.99m;

    public async Task<ProductBranchPricesDto?> Handle(SaveProductBranchPricesCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products.AsNoTracking()
            .Where(p => p.Id == request.ProductId)
            .Select(p => new { p.Id, p.Price })
            .FirstOrDefaultAsync(cancellationToken);
        if (product is null)
        {
            return null;
        }

        if (request.Branches.Select(b => b.BranchId).Distinct().Count() != request.Branches.Count)
        {
            throw new InvalidOperationException("A branch can only be listed once.");
        }

        foreach (var input in request.Branches)
        {
            if (input.Price is { } price && (price < MinPrice || price > MaxPrice || decimal.Round(price, 2) != price))
            {
                throw new InvalidOperationException("A branch price must be between 0.01 and 999,999.99, with at most two decimals.");
            }
        }

        var shopBranchIds = await BranchRules.AllOfShop(db)
            .Where(b => b.IsActive)
            .Select(b => b.Id)
            .ToListAsync(cancellationToken);
        if (request.Branches.Any(b => !shopBranchIds.Contains(b.BranchId)))
        {
            throw new InvalidOperationException("One or more branches were not found.");
        }

        if (request.Branches.Any(b => !db.MayWriteToBranch(b.BranchId)))
        {
            throw new ForbiddenActionException("You can only change prices of the branches you work in.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var existing = await db.ProductBranchPrices.IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .Where(p => p.ProductId == product.Id)
            .ToDictionaryAsync(p => p.BranchId, cancellationToken);
        var changes = new Dictionary<Guid, decimal?>();

        foreach (var input in request.Branches)
        {
            existing.TryGetValue(input.BranchId, out var row);
            var oldPrice = row?.Price;
            if (oldPrice == input.Price)
            {
                continue;
            }

            if (input.Price is null)
            {
                db.ProductBranchPrices.Remove(row!);
            }
            else if (row is null)
            {
                db.ProductBranchPrices.Add(new ProductBranchPrice
                {
                    ProductId = product.Id,
                    BranchId = input.BranchId,
                    Price = input.Price.Value,
                    CreatedAt = DateTime.UtcNow,
                    CreatedBy = userId
                });
            }
            else
            {
                row.Price = input.Price.Value;
                row.UpdatedAt = DateTime.UtcNow;
                row.UpdatedBy = userId;
            }

            CatalogChangeRecorder.RecordBranchPrice(db, product.Id, input.BranchId, oldPrice, input.Price, userId);
            changes[input.BranchId] = input.Price;
        }

        if (changes.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync(
                action: AuditAction.ProductUpdated,
                entityType: AuditEntityType.Product,
                entityId: product.Id.ToString(),
                oldValues: null,
                newValues: new { BranchPrices = changes.ToDictionary(c => c.Key.ToString(), c => c.Value) },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return await ProductBranchPricesLoader.LoadAsync(db, product.Id, cancellationToken);
    }
}
