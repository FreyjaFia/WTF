namespace WTF.Api.Common.Auth;

public sealed class ForbiddenActionException(string message, string? code = null) : Exception(message)
{
    public string? Code { get; } = code;
}
