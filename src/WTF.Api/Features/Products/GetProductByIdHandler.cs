using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;
using WTF.Domain.Data;
using ContractEnum = WTF.Contracts.Products.Enums.ProductTypeEnum;

namespace WTF.Api.Features.Products;

public class GetProductByIdHandler(WTFDbContext db) : IRequestHandler<GetProductByIdQuery, ProductDto?>
{
    public async Task<ProductDto?> Handle(GetProductByIdQuery request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.Id, cancellationToken);

        if (product == null)
        {
            return null;
        }

        return new ProductDto(
            product.Id,
            product.Name,
            product.Price,
            (ContractEnum)product.TypeId,
            product.IsAddOn,
            product.IsActive,
            product.CreatedAt,
            product.CreatedBy,
            product.UpdatedAt,
            product.UpdatedBy,
            product.ProductImage != null && product.ProductImage.Image != null
                ? product.ProductImage.Image.ImageUrl
                : null
        );
    }
}
