using MediatR;
using WTF.Api.Features.Products.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductBranchPricesQuery(Guid ProductId) : IRequest<ProductBranchPricesDto?>;

public class GetProductBranchPricesHandler(WTFDbContext db) : IRequestHandler<GetProductBranchPricesQuery, ProductBranchPricesDto?>
{
    public Task<ProductBranchPricesDto?> Handle(GetProductBranchPricesQuery request, CancellationToken cancellationToken)
    {
        return ProductBranchPricesLoader.LoadAsync(db, request.ProductId, cancellationToken);
    }
}
