namespace WTF.Contracts.Loyalty;

public record GetLoyaltyPointsDto(Guid CustomerId, int Points, string FirstName, string LastName)
{
    public string FullName => $"{FirstName} {LastName}";
}
