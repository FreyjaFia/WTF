using MediatR;

namespace WTF.Contracts.Products.Queries;

public record GetProductAddOnPriceOverridesQuery(Guid ProductId) : IRequest<List<ProductAddOnPriceOverrideDto>>;
