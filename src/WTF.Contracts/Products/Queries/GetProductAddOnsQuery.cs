using MediatR;
using WTF.Contracts.Products;

namespace WTF.Contracts.Products.Queries;

public record GetProductAddOnsQuery(Guid ProductId) : IRequest<List<ProductSimpleDto>>;
