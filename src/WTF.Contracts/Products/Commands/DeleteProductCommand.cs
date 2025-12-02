using MediatR;

namespace WTF.Contracts.Products.Commands;

public record DeleteProductCommand(Guid Id) : IRequest<bool>;
