using MediatR;
using WTF.Contracts;

namespace WTF.Api.Features.Loyalty.GetLoyaltyPoints
{
    public record GetLoyaltyPointsQuery(Guid CustomerId) : IRequest<LoyaltyPointsDto>;
}
