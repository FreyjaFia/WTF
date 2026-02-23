using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record UpdateProductCommand : IRequest<ProductDto?>
{
    [Required]
    public Guid Id { get; init; }

    [Required(ErrorMessage = "Product name is required")]
    [StringLength(100, ErrorMessage = "Name cannot exceed 100 characters")]
    public string Name { get; init; } = string.Empty;

    [Required(ErrorMessage = "Product code is required")]
    [StringLength(10, ErrorMessage = "Code cannot exceed 10 characters")]
    public string Code { get; init; } = string.Empty;

    [StringLength(500, ErrorMessage = "Description cannot exceed 500 characters")]
    public string? Description { get; init; }

    [Required(ErrorMessage = "Price is required")]
    [Range(0.01, 999999.99, ErrorMessage = "Price must be between 0.01 and 999,999.99")]
    public decimal Price { get; init; }

    [Required(ErrorMessage = "Product category is required")]
    public ProductCategoryEnum Category { get; init; }

    public bool IsAddOn { get; init; }

    public bool IsActive { get; init; }

    public ProductSubCategoryEnum? SubCategory { get; init; }
}

public class UpdateProductHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<UpdateProductCommand, ProductDto?>
{
    public async Task<ProductDto?> Handle(UpdateProductCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .FirstOrDefaultAsync(p => p.Id == request.Id, cancellationToken);

        if (product == null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var normalizedCode = request.Code.Trim().ToUpperInvariant();

        if (product.Code != normalizedCode)
        {
            var codeExists = await db.Products
                .AnyAsync(p => p.Code == normalizedCode && p.Id != request.Id, cancellationToken);

            if (codeExists)
            {
                throw new InvalidOperationException("Product code already exists.");
            }
        }

        // Validate IsAddOn change: Block changing from false to true if product has been used as parent item
        if (!product.IsAddOn && request.IsAddOn)
        {
            var hasParentOrders = await db.OrderItems
                .AnyAsync(oi => oi.ProductId == product.Id && oi.ParentOrderItemId == null, cancellationToken);

            if (hasParentOrders)
            {
                throw new InvalidOperationException(
                    "Cannot change product to add-on because it has been ordered as a main product. " +
                    "Products with order history as main items cannot be converted to add-ons.");
            }
        }

        if (product.Price != request.Price)
        {
            var historyRecord = new ProductPriceHistory
            {
                ProductId = product.Id,
                OldPrice = product.Price,
                NewPrice = request.Price,
                UpdatedAt = DateTime.UtcNow,
                UpdatedBy = userId
            };
            db.ProductPriceHistories.Add(historyRecord);
        }

        product.Name = request.Name;
        product.Code = normalizedCode;
        product.Description = request.Description;
        product.Price = request.Price;
        product.CategoryId = (int)request.Category;
        product.SubCategoryId = request.SubCategory.HasValue ? (int)request.SubCategory.Value : null;
        product.IsAddOn = request.IsAddOn;
        product.IsActive = request.IsActive;
        product.UpdatedAt = DateTime.UtcNow;
        product.UpdatedBy = userId;

        await db.SaveChangesAsync(cancellationToken);

        var imageUrl = product.ProductImage != null && product.ProductImage.Image != null
            ? product.ProductImage.Image.ImageUrl
            : null;

        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        var priceHistory = await db.ProductPriceHistories
            .Include(h => h.UpdatedByNavigation)
            .Where(h => h.ProductId == request.Id)
            .OrderByDescending(h => h.UpdatedAt)
            .Select(h => new ProductPriceHistoryDto(
                h.Id,
                h.ProductId,
                h.OldPrice,
                h.NewPrice,
                h.UpdatedAt,
                h.UpdatedBy,
                $"{h.UpdatedByNavigation.FirstName} {h.UpdatedByNavigation.LastName}"
            ))
            .ToListAsync(cancellationToken);

        return new ProductDto(
            product.Id,
            product.Name,
            product.Code,
            product.Description,
            product.Price,
            (ProductCategoryEnum)product.CategoryId,
            product.SubCategoryId.HasValue ? (ProductSubCategoryEnum)product.SubCategoryId.Value : null,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            imageUrl,
            priceHistory
        );
    }
}
