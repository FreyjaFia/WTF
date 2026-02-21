namespace WTF.Api.Features.Loyalty.DTOs;

public record ShortenLoyaltyDto(Guid CustomerId, int Points, string FirstName, string LastName)
{
    public string FullName => $"{FirstName} {LastName}";
}
