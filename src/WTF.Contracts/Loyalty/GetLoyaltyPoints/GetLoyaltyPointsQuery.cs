using MediatR;
using WTF.Contracts.Loyalty.GetLoyaltyPoints;

namespace WTF.Contracts.Loyalty.GetLoyaltyPoints;

public record GetLoyaltyPointsQuery(Guid CustomerId) : IRequest<GetLoyaltyPointsDto>;
