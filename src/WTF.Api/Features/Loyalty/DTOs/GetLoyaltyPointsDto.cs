namespace WTF.Api.Features.Loyalty.DTOs;

public record GetLoyaltyPointsDto(Guid CustomerId, int Points, string FirstName, string LastName)
{
    public string FullName => $"{FirstName} {LastName}";
}
