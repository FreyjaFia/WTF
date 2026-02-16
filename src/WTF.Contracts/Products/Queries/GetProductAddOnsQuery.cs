using MediatR;

namespace WTF.Contracts.Products.Queries;

public record GetProductAddOnsQuery(Guid ProductId) : IRequest<List<AddOnGroupDto>>;
