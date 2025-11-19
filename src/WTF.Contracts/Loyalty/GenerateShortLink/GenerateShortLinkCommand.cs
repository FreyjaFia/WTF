using MediatR;
using WTF.Contracts.Loyalty.GenerateShortLink;

namespace WTF.Contracts.Loyalty.GenerateShortLink;

public record GenerateShortLinkCommand(Guid CustomerId) : IRequest<GenerateShortLinkDto>;
