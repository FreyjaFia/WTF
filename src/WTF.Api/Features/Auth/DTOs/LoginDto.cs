namespace WTF.Api.Features.Auth.DTOs;

public record LoginDto(string AccessToken, string RefreshToken, DateTime ExpiresAt);
