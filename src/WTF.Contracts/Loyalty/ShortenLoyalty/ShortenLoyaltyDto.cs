namespace WTF.Contracts.Loyalty.ShortenLoyalty;

public record ShortenLoyaltyDto(Guid CustomerId, int Points, string FirstName, string LastName)
{
    public string FullName => $"{FirstName} {LastName}";
}
