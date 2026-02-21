using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record CreateProductCommand : IRequest<ProductDto>
{
    [Required(ErrorMessage = "Product name is required")]
    [StringLength(100, ErrorMessage = "Name cannot exceed 100 characters")]
    public string Name { get; init; } = string.Empty;

    [Required(ErrorMessage = "Product code is required")]
    [StringLength(10, ErrorMessage = "Code cannot exceed 10 characters")]
    public string Code { get; init; } = string.Empty;

    [StringLength(500, ErrorMessage = "Description cannot exceed 500 characters")]
    public string? Description { get; init; }

    [Required(ErrorMessage = "Price is required")]
    [Range(0, 999999.99, ErrorMessage = "Price must be between 0 and 999,999.99")]
    public decimal Price { get; init; }

    [Required(ErrorMessage = "Product category is required")]
    public ProductCategoryEnum Category { get; init; }

    public bool IsAddOn { get; init; }

    public bool IsActive { get; init; } = true;
}

public class CreateProductHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateProductCommand, ProductDto>
{
    public async Task<ProductDto> Handle(CreateProductCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var normalizedCode = request.Code.Trim().ToUpperInvariant();

        var codeExists = await db.Products
            .AnyAsync(p => p.Code == normalizedCode, cancellationToken);

        if (codeExists)
        {
            throw new InvalidOperationException("Product code already exists.");
        }

        var product = new Product
        {
            Name = request.Name,
            Code = normalizedCode,
            Description = request.Description,
            Price = request.Price,
            CategoryId = (int)request.Category,
            IsAddOn = request.IsAddOn,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Products.Add(product);
        await db.SaveChangesAsync(cancellationToken);

        return new ProductDto(
            product.Id,
            product.Name,
            product.Code,
            product.Description,
            product.Price,
            (ProductCategoryEnum)product.CategoryId,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            null,
            []
        );
    }
}
