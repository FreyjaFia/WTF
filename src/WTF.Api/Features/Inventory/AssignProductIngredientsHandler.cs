using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record ProductIngredientInputDto(
    Guid ItemId,
    [Range(0.001, 999999.999)]
    decimal QuantityPerSale,
    [Range(0, 100)]
    decimal AllowancePercent = 0m,
    bool ScalesWithSize = false,
    Guid? ReplacesItemId = null);

public record AssignProductIngredientsCommand : IRequest<bool>
{
    [Required]
    public Guid ProductId { get; init; }

    [Required]
    public List<ProductIngredientInputDto> Lines { get; init; } = [];
}

// Saves a product's whole ingredient list: lines that are listed are added or updated (a line switched off earlier comes
// back), active lines that are no longer listed are switched off and kept. Nothing is ever deleted.
public class AssignProductIngredientsHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<AssignProductIngredientsCommand, bool>
{
    public async Task<bool> Handle(AssignProductIngredientsCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);
        if (product is null)
        {
            return false;
        }

        var lines = request.Lines;
        if (lines.GroupBy(line => line.ItemId).Any(group => group.Count() > 1))
        {
            throw new InvalidOperationException("An ingredient can be listed only once.");
        }

        if (lines.Any(line => line.QuantityPerSale <= 0))
        {
            throw new InvalidOperationException("The amount per sale must be greater than zero.");
        }

        if (lines.Any(line => line.AllowancePercent is < 0 or > 100))
        {
            throw new InvalidOperationException("The allowance must be between 0 and 100 percent.");
        }

        var itemIds = lines.Select(line => line.ItemId).ToList();
        var items = await db.Items
            .Where(item => itemIds.Contains(item.Id))
            .Select(item => new { item.Id, item.IsActive })
            .ToListAsync(cancellationToken);
        if (items.Count != itemIds.Count)
        {
            throw new InvalidOperationException("One or more ingredients were not found.");
        }

        await ValidateReplacementsAsync(product.IsAddOn, lines, cancellationToken);

        var existing = await db.ProductItemLinks
            .Include(link => link.Item)
            .Where(link => link.ProductId == product.Id)
            .ToListAsync(cancellationToken);
        var existingByItem = existing.ToDictionary(link => link.ItemId);
        var now = DateTime.UtcNow;

        if (items.Any(item => !item.IsActive && !(existingByItem.TryGetValue(item.Id, out var link) && link.IsActive)))
        {
            throw new InvalidOperationException("An inactive item cannot be added. Restore it first.");
        }

        // Links to inactive items are not on the page, so they are left as they are.
        var removed = existing
            .Where(link => link.IsActive && link.Item.IsActive && !itemIds.Contains(link.ItemId))
            .ToList();
        foreach (var link in removed)
        {
            link.IsActive = false;
            link.UpdatedAt = now;
            link.UpdatedBy = userId;
        }

        foreach (var line in lines)
        {
            if (existingByItem.TryGetValue(line.ItemId, out var link))
            {
                link.QuantityPerSale = line.QuantityPerSale;
                link.AllowancePercent = line.AllowancePercent;
                link.ScalesWithSize = line.ScalesWithSize;
                link.ReplacesItemId = line.ReplacesItemId;
                link.IsActive = true;
                link.UpdatedAt = now;
                link.UpdatedBy = userId;
                continue;
            }

            db.ProductItemLinks.Add(new ProductItemLink
            {
                ProductId = product.Id,
                ItemId = line.ItemId,
                QuantityPerSale = line.QuantityPerSale,
                AllowancePercent = line.AllowancePercent,
                ScalesWithSize = line.ScalesWithSize,
                ReplacesItemId = line.ReplacesItemId,
                IsActive = true,
                CreatedAt = now,
                CreatedBy = userId
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductItemLinked,
            AuditEntityType.ProductItemLink,
            product.Id.ToString(),
            newValues: new
            {
                ProductId = product.Id,
                LineCount = lines.Count,
                RemovedItemIds = removed.Select(link => link.ItemId),
                Lines = lines.Select(line => new { line.ItemId, line.QuantityPerSale, line.AllowancePercent, line.ScalesWithSize, line.ReplacesItemId })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }

    private async Task ValidateReplacementsAsync(bool isAddOn, List<ProductIngredientInputDto> lines, CancellationToken cancellationToken)
    {
        var replacing = lines.Where(line => line.ReplacesItemId.HasValue).ToList();
        if (replacing.Count == 0)
        {
            return;
        }

        if (!isAddOn)
        {
            throw new InvalidOperationException("Only an add-on can replace an ingredient.");
        }

        if (replacing.Any(line => line.ReplacesItemId == line.ItemId))
        {
            throw new InvalidOperationException("An item cannot replace itself.");
        }

        var replacedIds = replacing.Select(line => line.ReplacesItemId!.Value).Distinct().ToList();
        if (await db.Items.CountAsync(item => replacedIds.Contains(item.Id), cancellationToken) != replacedIds.Count)
        {
            throw new InvalidOperationException("The item to replace was not found.");
        }
    }
}
