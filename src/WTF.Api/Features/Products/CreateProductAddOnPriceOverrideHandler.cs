using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record CreateProductAddOnPriceOverrideCommand : IRequest<ProductAddOnPriceOverrideDto?>
{
    [Required] public Guid ProductId { get; init; }
    [Required] public Guid AddOnId { get; init; }
    public decimal Price { get; init; }
    public bool IsActive { get; init; } = true;
}

public class CreateProductAddOnPriceOverrideHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateProductAddOnPriceOverrideCommand, ProductAddOnPriceOverrideDto?>
{
    public async Task<ProductAddOnPriceOverrideDto?> Handle(CreateProductAddOnPriceOverrideCommand request, CancellationToken cancellationToken)
    {
        var productAddOnExists = await db.ProductAddOns
            .AnyAsync(pa => pa.ProductId == request.ProductId && pa.AddOnId == request.AddOnId && pa.IsActive, cancellationToken);

        if (!productAddOnExists)
        {
            return null;
        }

        var existing = await db.ProductAddOnPriceOverrides
            .FirstOrDefaultAsync(o => o.ProductId == request.ProductId && o.AddOnId == request.AddOnId, cancellationToken);

        if (existing is { IsActive: true })
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        // A previously deleted (inactive) override is reused instead of creating a duplicate row
        if (existing is not null)
        {
            existing.Price = request.Price;
            existing.IsActive = request.IsActive;
            existing.UpdatedAt = DateTime.UtcNow;
            existing.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);

            return new ProductAddOnPriceOverrideDto(
                existing.ProductId,
                existing.AddOnId,
                existing.Price,
                existing.IsActive
            );
        }

        var item = new ProductAddOnPriceOverride
        {
            ProductId = request.ProductId,
            AddOnId = request.AddOnId,
            Price = request.Price,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.ProductAddOnPriceOverrides.Add(item);
        await db.SaveChangesAsync(cancellationToken);

        return new ProductAddOnPriceOverrideDto(
            item.ProductId,
            item.AddOnId,
            item.Price,
            item.IsActive
        );
    }
}
