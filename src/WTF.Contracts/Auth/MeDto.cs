namespace WTF.Contracts.Auth;

public record MeDto(
    string FirstName,
    string LastName,
    string? ImageUrl
);
