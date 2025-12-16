using MediatR;
using WTF.Api.Common.Extensions;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using ContractEnum = WTF.Contracts.Products.Enums.ProductTypeEnum;

namespace WTF.Api.Features.Products;

public class CreateProductHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<CreateProductCommand, ProductDto>
{
    public async Task<ProductDto> Handle(CreateProductCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var product = new Product
        {
            Name = request.Name,
            Price = request.Price,
            TypeId = (int)request.Type, // Store as int
            IsAddOn = request.IsAddOn,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId // TODO: Get from authenticated user context
        };

        db.Products.Add(product);
        await db.SaveChangesAsync(cancellationToken);

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
            null // Set ImageUrl to null
        );
    }
}
