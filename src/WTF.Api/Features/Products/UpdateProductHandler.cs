using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductTypeEnum;

namespace WTF.Api.Features.Products;

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

        product.Name = request.Name;
        product.Price = request.Price;
        product.TypeId = (int)request.Type; // Store as int
        product.IsAddOn = request.IsAddOn;
        product.IsActive = request.IsActive;
        product.UpdatedAt = DateTime.UtcNow;
        product.UpdatedBy = userId; // Set from current user service

        await db.SaveChangesAsync(cancellationToken);

        var imageUrl = product.ProductImage != null && product.ProductImage.Image != null
            ? product.ProductImage.Image.ImageUrl
            : null;

        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        return new ProductDto(
            product.Id,
            product.Name,
            product.Price,
            (ContractEnum)product.TypeId, // Convert int to contract enum
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            imageUrl
        );
    }
}
