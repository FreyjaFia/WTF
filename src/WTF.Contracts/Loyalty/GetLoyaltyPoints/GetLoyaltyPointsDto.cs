namespace WTF.Contracts.Loyalty.GetLoyaltyPoints;

public record GetLoyaltyPointsDto(Guid CustomerId, int Points, string FirstName, string LastName)
{
    public string FullName => $"{FirstName} {LastName}";
}
