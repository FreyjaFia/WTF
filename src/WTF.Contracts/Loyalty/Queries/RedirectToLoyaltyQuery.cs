using MediatR;

namespace WTF.Contracts.Loyalty.Queries;

public record RedirectToLoyaltyQuery(string Token) : IRequest<RedirectToLoyaltyDto>;
