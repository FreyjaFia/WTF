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
    [Range(0, double.MaxValue)] public decimal Price { get; init; }
    public bool IsActive { get; init; } = true;
}

public class CreateProductAddOnPriceOverrideHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateProductAddOnPriceOverrideCommand, ProductAddOnPriceOverrideDto?>
{
    public async Task<ProductAddOnPriceOverrideDto?> Handle(CreateProductAddOnPriceOverrideCommand request, CancellationToken cancellationToken)
    {
        var productAddOnExists = await db.ProductAddOns
            .AnyAsync(pa => pa.ProductId == request.ProductId && pa.AddOnId == request.AddOnId, cancellationToken);

        if (!productAddOnExists)
        {
            return null;
        }

        var alreadyExists = await db.ProductAddOnPriceOverrides
            .AnyAsync(o => o.ProductId == request.ProductId && o.AddOnId == request.AddOnId, cancellationToken);

        if (alreadyExists)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
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
