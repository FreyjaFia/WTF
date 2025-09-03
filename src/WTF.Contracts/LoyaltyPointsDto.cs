namespace WTF.Contracts
{
    public record LoyaltyPointsDto(Guid CustomerId, int Points, string FirstName, string LastName)
    {
        public string FullName => $"{FirstName} {LastName}";
    };
}
