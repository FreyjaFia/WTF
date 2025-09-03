using MediatR;
using WTF.Contracts;

namespace WTF.Api.Features.Loyalty.RedirectToLoyalty
{
    public record RedirectToLoyaltyQuery(string Token) : IRequest<RedirectToLoyaltyDto>;
}
