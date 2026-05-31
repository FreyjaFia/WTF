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

public record LinkProductItemCommand : IRequest<ProductItemLinkDto>
{
    public Guid ProductId { get; init; }

    public Guid ItemId { get; init; }

    [Range(0.001, 999999.999)]
    public decimal QuantityPerSale { get; init; } = 1;
}

public class LinkProductItemHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<LinkProductItemCommand, ProductItemLinkDto>
{
    public async Task<ProductItemLinkDto> Handle(LinkProductItemCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken)
            ?? throw new InvalidOperationException("Product not found.");
        var item = await db.Items.FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken)
            ?? throw new InvalidOperationException("Item not found.");

        var link = await db.ProductItemLinks
            .FirstOrDefaultAsync(
                l => l.ProductId == request.ProductId && l.ItemId == request.ItemId,
                cancellationToken);

        if (link is null)
        {
            link = new ProductItemLink
            {
                ProductId = request.ProductId,
                ItemId = request.ItemId,
                QuantityPerSale = request.QuantityPerSale,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId
            };
            db.ProductItemLinks.Add(link);
        }
        else
        {
            link.QuantityPerSale = request.QuantityPerSale;
            link.IsActive = true;
            link.UpdatedAt = DateTime.UtcNow;
            link.UpdatedBy = userId;
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ProductItemLinked,
            AuditEntityType.ProductItemLink,
            link.Id.ToString(),
            newValues: new
            {
                product.Id,
                ProductName = product.Name,
                ItemId = item.Id,
                ItemName = item.Name,
                link.QuantityPerSale,
                link.IsActive
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return new ProductItemLinkDto(
            link.Id,
            product.Id,
            product.Name,
            product.Code,
            item.Id,
            link.QuantityPerSale,
            link.IsActive);
    }
}
