using MediatR;

namespace WTF.Contracts.Products.Commands;

public record DeleteProductAddOnPriceOverrideCommand(Guid ProductId, Guid AddOnId) : IRequest<bool>;
