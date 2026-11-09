namespace WTF.Api.Common.Auth;

public sealed class ForbiddenActionException(string message) : Exception(message);
