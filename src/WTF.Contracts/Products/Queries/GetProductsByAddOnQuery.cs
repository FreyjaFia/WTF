using MediatR;

namespace WTF.Contracts.Products.Queries;

public record GetProductsByAddOnQuery(Guid AddOnId) : IRequest<List<AddOnGroupDto>>;
