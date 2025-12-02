namespace WTF.Contracts.Auth.Validate;

public record ValidateTokenDto(bool IsValid, string Message, DateTime Timestamp);
