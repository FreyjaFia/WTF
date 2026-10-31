using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record ProductSizeAmountInputDto(
    Guid SizeProductId,
    [Range(0.001, 999999.999)]
    decimal Quantity);

public record ProductIngredientInputDto(
    Guid ItemId,
    [Range(0.001, 999999.999)]
    decimal QuantityPerSale,
    [Range(0, 100)]
    decimal AllowancePercent = 0m,
    bool ScalesWithSize = false,
    Guid? ReplacesItemId = null,
    List<ProductSizeAmountInputDto>? SizeAmounts = null);

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
        var sizeIds = await ValidateSizeAmountsAsync(product, lines, cancellationToken);

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

        await SaveSizeAmountsAsync(product.Id, lines, userId, now, cancellationToken);

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
                Lines = lines.Select(line => new { line.ItemId, line.QuantityPerSale, line.AllowancePercent, line.ScalesWithSize, line.ReplacesItemId, SizeAmounts = line.SizeAmounts ?? [] })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return true;
    }

    private async Task<HashSet<Guid>> ValidateSizeAmountsAsync(
        Product product, List<ProductIngredientInputDto> lines, CancellationToken cancellationToken)
    {
        var amounts = lines.SelectMany(line => line.SizeAmounts ?? []).ToList();
        if (amounts.Count == 0)
        {
            return [];
        }

        if (product.IsAddOn)
        {
            throw new InvalidOperationException("Amounts per size are set on a drink, not on an add-on.");
        }

        if (lines.Any(line => (line.SizeAmounts ?? []).GroupBy(amount => amount.SizeProductId).Any(group => group.Count() > 1)))
        {
            throw new InvalidOperationException("An ingredient can have only one amount per size.");
        }

        if (amounts.Any(amount => amount.Quantity <= 0))
        {
            throw new InvalidOperationException("The amount for a size must be greater than zero.");
        }

        var sizeIds = await db.ProductAddOns
            .Where(pa => pa.ProductId == product.Id && pa.IsActive && pa.AddOnTypeId == (int)AddOnTypeEnum.Size)
            .Select(pa => pa.AddOnId)
            .ToListAsync(cancellationToken);
        if (amounts.Any(amount => !sizeIds.Contains(amount.SizeProductId)))
        {
            throw new InvalidOperationException("One of the sizes is not a size of this product.");
        }

        return [.. sizeIds];
    }

    private async Task SaveSizeAmountsAsync(
        Guid productId, List<ProductIngredientInputDto> lines, Guid userId, DateTime now, CancellationToken cancellationToken)
    {
        var existing = await db.ProductSizeAmounts
            .Where(amount => amount.ProductId == productId)
            .ToListAsync(cancellationToken);
        var wanted = lines
            .SelectMany(line => (line.SizeAmounts ?? []).Select(amount => (line.ItemId, amount.SizeProductId, amount.Quantity)))
            .ToList();

        foreach (var row in existing.Where(row => row.IsActive && !wanted.Any(w => w.ItemId == row.ItemId && w.SizeProductId == row.SizeProductId)))
        {
            row.IsActive = false;
            row.UpdatedAt = now;
            row.UpdatedBy = userId;
        }

        foreach (var (itemId, sizeProductId, quantity) in wanted)
        {
            var row = existing.FirstOrDefault(r => r.ItemId == itemId && r.SizeProductId == sizeProductId);
            if (row is null)
            {
                db.ProductSizeAmounts.Add(new ProductSizeAmount
                {
                    ProductId = productId,
                    SizeProductId = sizeProductId,
                    ItemId = itemId,
                    Quantity = quantity,
                    IsActive = true,
                    CreatedAt = now,
                    CreatedBy = userId
                });
                continue;
            }

            row.Quantity = quantity;
            row.IsActive = true;
            row.UpdatedAt = now;
            row.UpdatedBy = userId;
        }
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
