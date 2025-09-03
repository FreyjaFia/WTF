using MediatR;
using WTF.Contracts;

namespace WTF.Api.Features.Loyalty.GenerateShortLink
{
    public record GenerateShortLinkCommand(Guid CustomerId) : IRequest<ShortLinkDto>;
}
