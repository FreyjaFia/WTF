namespace WTF.Contracts.Users;

public record UserDto(
    Guid Id,
    string FirstName,
    string LastName,
    string Username,
    bool IsActive,
    string? ImageUrl
);