namespace WTF.Api.Features.Platform;

public static class PlatformActions
{
    public const string Login = "Login";
    public const string LoginFailed = "LoginFailed";
    public const string LoginLocked = "LoginLocked";
    public const string TenantCreated = "TenantCreated";
    public const string TenantSuspended = "TenantSuspended";
    public const string TenantResumed = "TenantResumed";
    public const string TenantCancelled = "TenantCancelled";
    public const string TenantExported = "TenantExported";
    public const string TenantDeleted = "TenantDeleted";
    public const string PasswordReset = "PasswordReset";
    public const string ImpersonationStarted = "ImpersonationStarted";
    public const string ImpersonatedAction = "ImpersonatedAction";
}
