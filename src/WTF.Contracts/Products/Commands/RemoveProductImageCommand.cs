using MediatR;
using WTF.Contracts.Products;

namespace WTF.Contracts.Products.Commands;

public record RemoveProductImageCommand(Guid ProductId) : IRequest<ProductDto?>;
