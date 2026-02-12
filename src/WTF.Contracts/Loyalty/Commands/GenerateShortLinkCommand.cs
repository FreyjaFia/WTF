using MediatR;

namespace WTF.Contracts.Loyalty.Commands;

public record GenerateShortLinkCommand(Guid CustomerId) : IRequest<GenerateShortLinkDto>;
