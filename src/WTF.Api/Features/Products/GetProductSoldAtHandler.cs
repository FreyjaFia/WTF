using MediatR;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductSoldAtQuery(Guid ProductId) : IRequest<ProductSoldAtDto?>;

public class GetProductSoldAtHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductSoldAtQuery, ProductSoldAtDto?>
{
    public Task<ProductSoldAtDto?> Handle(GetProductSoldAtQuery request, CancellationToken cancellationToken)
    {
        return ProductSoldAtLoader.LoadAsync(db, httpContextAccessor.HttpContext!.User, request.ProductId, cancellationToken);
    }
}
