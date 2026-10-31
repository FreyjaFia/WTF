using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record BulkIngredientLineDto(
    Guid ItemId,
    [Range(0.001, 999999.999)]
    decimal QuantityPerSale,
    [Range(0, 100)]
    decimal AllowancePercent = 0m);

public record BulkAddProductIngredientsCommand : IRequest<BulkAddProductIngredientsResult>
{
    [Required]
    public List<Guid> ProductIds { get; init; } = [];

    [Required]
    public List<BulkIngredientLineDto> Lines { get; init; } = [];
}

public record BulkAddSkippedDto(Guid ProductId, string ProductName, string ItemName);

public record BulkAddProductIngredientsResult(int Added, List<BulkAddSkippedDto> Skipped);

// Adds the same ingredient lines to many products at once. Add-only: a product that already has an ingredient keeps its own
// amount and is listed as skipped; a line that was switched off earlier comes back with the new amount. One transaction.
public class BulkAddProductIngredientsHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<BulkAddProductIngredientsCommand, BulkAddProductIngredientsResult>
{
    private const int MaxProducts = 200;

    public async Task<BulkAddProductIngredientsResult> Handle(BulkAddProductIngredientsCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var productIds = request.ProductIds.Distinct().ToList();
        if (productIds.Count == 0)
        {
            throw new InvalidOperationException("Pick at least one product.");
        }

        if (productIds.Count > MaxProducts)
        {
            throw new InvalidOperationException($"Pick at most {MaxProducts} products at a time.");
        }

        var lines = request.Lines;
        if (lines.Count == 0)
        {
            throw new InvalidOperationException("Add at least one ingredient.");
        }

        if (lines.GroupBy(line => line.ItemId).Any(group => group.Count() > 1))
        {
            throw new InvalidOperationException("An ingredient can be listed only once.");
        }

        if (lines.Any(line => line.QuantityPerSale <= 0 || line.AllowancePercent is < 0 or > 100))
        {
            throw new InvalidOperationException("Check the amounts: they must be above zero, and the allowance between 0 and 100 percent.");
        }

        var itemIds = lines.Select(line => line.ItemId).ToList();
        var items = await db.Items
            .Where(item => itemIds.Contains(item.Id))
            .Select(item => new { item.Id, item.Name, item.IsActive })
            .ToListAsync(cancellationToken);
        if (items.Count != itemIds.Count)
        {
            throw new InvalidOperationException("One or more ingredients were not found.");
        }

        if (items.Any(item => !item.IsActive))
        {
            throw new InvalidOperationException("An inactive item cannot be added. Restore it first.");
        }

        var products = await db.Products
            .Where(product => productIds.Contains(product.Id))
            .Select(product => new { product.Id, product.Name, product.IsActive })
            .ToListAsync(cancellationToken);
        if (products.Count != productIds.Count)
        {
            throw new InvalidOperationException("One or more products were not found.");
        }

        if (products.Any(product => !product.IsActive))
        {
            throw new InvalidOperationException("A deleted product cannot get ingredients. Restore it first.");
        }

        var existing = await db.ProductItemLinks
            .Where(link => productIds.Contains(link.ProductId) && itemIds.Contains(link.ItemId))
            .ToListAsync(cancellationToken);

        var itemNames = items.ToDictionary(item => item.Id, item => item.Name);
        var skipped = new List<BulkAddSkippedDto>();
        var added = 0;
        var now = DateTime.UtcNow;

        foreach (var product in products.OrderBy(p => p.Name))
        {
            foreach (var line in lines)
            {
                var link = existing.FirstOrDefault(l => l.ProductId == product.Id && l.ItemId == line.ItemId);
                if (link is { IsActive: true })
                {
                    skipped.Add(new BulkAddSkippedDto(product.Id, product.Name, itemNames[line.ItemId]));
                    continue;
                }

                if (link is not null)
                {
                    link.QuantityPerSale = line.QuantityPerSale;
                    link.AllowancePercent = line.AllowancePercent;
                    link.ScalesWithSize = false;
                    link.ReplacesItemId = null;
                    link.IsActive = true;
                    link.UpdatedAt = now;
                    link.UpdatedBy = userId;
                }
                else
                {
                    db.ProductItemLinks.Add(new ProductItemLink
                    {
                        ProductId = product.Id,
                        ItemId = line.ItemId,
                        QuantityPerSale = line.QuantityPerSale,
                        AllowancePercent = line.AllowancePercent,
                        IsActive = true,
                        CreatedAt = now,
                        CreatedBy = userId
                    });
                }

                added++;
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductItemLinked,
            AuditEntityType.ProductItemLink,
            productIds.Count == 1 ? productIds[0].ToString() : "bulk",
            newValues: new
            {
                ProductIds = productIds,
                Added = added,
                Skipped = skipped.Count,
                Lines = lines.Select(line => new { line.ItemId, line.QuantityPerSale, line.AllowancePercent })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return new BulkAddProductIngredientsResult(added, skipped);
    }
}
