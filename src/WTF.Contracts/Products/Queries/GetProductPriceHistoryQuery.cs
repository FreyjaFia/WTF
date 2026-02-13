using MediatR;

namespace WTF.Contracts.Products.Queries;

public record GetProductPriceHistoryQuery(Guid ProductId) : IRequest<List<ProductPriceHistoryDto>>;
