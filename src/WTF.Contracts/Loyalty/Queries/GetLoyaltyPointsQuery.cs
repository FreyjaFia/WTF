using MediatR;

namespace WTF.Contracts.Loyalty.Queries;

public record GetLoyaltyPointsQuery(Guid CustomerId) : IRequest<GetLoyaltyPointsDto>;
