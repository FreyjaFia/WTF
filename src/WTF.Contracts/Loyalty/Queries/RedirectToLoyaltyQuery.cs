using MediatR;
using WTF.Contracts.Loyalty.RedirectToLoyalty;

namespace WTF.Contracts.Loyalty.RedirectToLoyalty;

public record RedirectToLoyaltyQuery(string Token) : IRequest<RedirectToLoyaltyDto>;
