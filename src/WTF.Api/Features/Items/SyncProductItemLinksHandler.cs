using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public record SyncProductItemLinksCommand : IRequest<ItemDto?>
{
    [Required]
    public Guid ItemId { get; init; }

    [Required]
    public List<ProductItemLinkAssignmentDto> ProductLinks { get; init; } = [];
}

public class SyncProductItemLinksHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SyncProductItemLinksCommand, ItemDto?>
{
    public async Task<ItemDto?> Handle(SyncProductItemLinksCommand request, CancellationToken cancellationToken)
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

        var existingLinks = await db.ProductItemLinks
            .Where(link => link.ItemId == request.ItemId)
            .ToListAsync(cancellationToken);

        var existingByProductId = existingLinks.ToDictionary(link => link.ProductId);

        var removedLinks = existingLinks
            .Where(link => !requestedProductIds.Contains(link.ProductId))
            .ToList();

        if (removedLinks.Count > 0)
        {
            db.ProductItemLinks.RemoveRange(removedLinks);
        }

        foreach (var link in distinctLinks)
        {
            if (existingByProductId.TryGetValue(link.ProductId, out var existing))
            {
                existing.QuantityPerSale = link.QuantityPerSale;
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
                LinkedProducts = distinctLinks.Select(link => new
                {
                    link.ProductId,
                    link.QuantityPerSale,
                    link.IsActive
                })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        var updatedItem = await db.Items
            .AsNoTracking()
            .Include(i => i.ItemPriceHistories)
                .ThenInclude(h => h.UpdatedByNavigation)
            .Include(i => i.ProductItemLinks)
                .ThenInclude(l => l.Product)
            .Include(i => i.StockMovements.OrderByDescending(m => m.CreatedAt).Take(25))
                .ThenInclude(m => m.CreatedByNavigation)
            .FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);

        return updatedItem is null ? null : ItemMapping.ToDto(updatedItem);
    }
}
