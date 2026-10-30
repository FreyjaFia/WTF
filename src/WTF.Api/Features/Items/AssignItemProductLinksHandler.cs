using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public record AssignItemProductLinksCommand : IRequest<ItemDto?>
{
    [Required]
    public Guid ItemId { get; init; }

    [Required]
    public List<ProductItemLinkAssignmentDto> ProductLinks { get; init; } = [];
}

public class AssignItemProductLinksHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<AssignItemProductLinksCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(AssignItemProductLinksCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var distinctLinks = request.ProductLinks
            .GroupBy(link => link.ProductId)
            .Select(group =>
            {
                if (group.Count() > 1)
                {
                    throw new InvalidOperationException("Duplicate product IDs are not allowed.");
                }

                return group.Single();
            })
            .ToList();

        if (distinctLinks.Any(link => link.QuantityPerSale <= 0))
        {
            throw new InvalidOperationException("Quantity per sale must be greater than zero.");
        }

        var requestedProductIds = distinctLinks.Select(link => link.ProductId).ToList();
        var products = await db.Products
            .Where(product => requestedProductIds.Contains(product.Id))
            .Select(product => new { product.Id, product.Name, product.Code })
            .ToListAsync(cancellationToken);

        if (products.Count != requestedProductIds.Count)
        {
            throw new InvalidOperationException("One or more selected products were not found.");
        }

        await ValidateReplacementsAsync(request.ItemId, distinctLinks, cancellationToken);

        var existingLinks = await db.ProductItemLinks
            .Where(link => link.ItemId == request.ItemId)
            .ToListAsync(cancellationToken);

        var existingByProductId = existingLinks.ToDictionary(link => link.ProductId);

        var removedLinks = existingLinks
            .Where(link => link.IsActive && !requestedProductIds.Contains(link.ProductId))
            .ToList();

        foreach (var removed in removedLinks)
        {
            removed.IsActive = false;
            removed.UpdatedAt = DateTime.UtcNow;
            removed.UpdatedBy = userId;
        }

        foreach (var link in distinctLinks)
        {
            if (existingByProductId.TryGetValue(link.ProductId, out var existing))
            {
                existing.QuantityPerSale = link.QuantityPerSale;
                existing.AllowancePercent = link.AllowancePercent;
                existing.ScalesWithSize = link.ScalesWithSize;
                existing.ReplacesItemId = link.ReplacesItemId;
                existing.IsActive = link.IsActive;
                existing.UpdatedAt = DateTime.UtcNow;
                existing.UpdatedBy = userId;
                continue;
            }

            db.ProductItemLinks.Add(new ProductItemLink
            {
                ItemId = request.ItemId,
                ProductId = link.ProductId,
                QuantityPerSale = link.QuantityPerSale,
                AllowancePercent = link.AllowancePercent,
                ScalesWithSize = link.ScalesWithSize,
                ReplacesItemId = link.ReplacesItemId,
                IsActive = link.IsActive,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductItemLinked,
            AuditEntityType.ProductItemLink,
            request.ItemId.ToString(),
            newValues: new
            {
                request.ItemId,
                LinkCount = distinctLinks.Count,
                RemovedProductIds = removedLinks.Select(link => link.ProductId),
                LinkedProducts = distinctLinks.Select(link => new
                {
                    link.ProductId,
                    link.QuantityPerSale,
                    link.AllowancePercent,
                    link.ScalesWithSize,
                    link.ReplacesItemId,
                    link.IsActive
                })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        var updatedItem = await db.Items
            .AsNoTracking()
            .Include(i => i.ItemPriceHistories)
                .ThenInclude(h => h.UpdatedByNavigation)
            .Include(i => i.ProductItemLinkItems)
                .ThenInclude(l => l.Product)
            .Include(i => i.ProductItemLinkItems)
                .ThenInclude(l => l.ReplacesItem)
            .Include(i => i.StockMovements.OrderByDescending(m => m.CreatedAt).Take(25))
                .ThenInclude(m => m.CreatedByNavigation)
            .FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);

        return updatedItem is null ? null : ItemMapping.ToDto(updatedItem);
    }

    private async Task ValidateReplacementsAsync(
        Guid itemId, List<ProductItemLinkAssignmentDto> links, CancellationToken cancellationToken)
    {
        var replacing = links.Where(link => link.ReplacesItemId.HasValue).ToList();
        if (replacing.Count == 0)
        {
            return;
        }

        if (replacing.Any(link => link.ReplacesItemId == itemId))
        {
            throw new InvalidOperationException("An item cannot replace itself.");
        }

        var replacedIds = replacing.Select(link => link.ReplacesItemId!.Value).Distinct().ToList();
        var foundItems = await db.Items.CountAsync(item => replacedIds.Contains(item.Id), cancellationToken);
        if (foundItems != replacedIds.Count)
        {
            throw new InvalidOperationException("The item to replace was not found.");
        }

        var productIds = replacing.Select(link => link.ProductId).ToList();
        var nonAddOns = await db.Products
            .Where(product => productIds.Contains(product.Id) && !product.IsAddOn)
            .Select(product => product.Name)
            .ToListAsync(cancellationToken);
        if (nonAddOns.Count > 0)
        {
            throw new InvalidOperationException($"Only an add-on can replace an item. {nonAddOns[0]} is not an add-on.");
        }
    }
}
