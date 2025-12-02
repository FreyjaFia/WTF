using MediatR;

namespace WTF.Contracts.Products.Queries;

public record GetProductByIdQuery(Guid Id) : IRequest<ProductDto?>;
