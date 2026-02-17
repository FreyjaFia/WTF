namespace WTF.Contracts.Auth;

public record LoginDto(
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresAt
);
