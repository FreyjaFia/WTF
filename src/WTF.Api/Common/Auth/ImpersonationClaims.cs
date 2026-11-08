namespace WTF.Api.Common.Auth;

public static class ImpersonationClaims
{
    public const string By = "impersonated_by";
    public const string ByName = "impersonated_by_name";
    public const string ReadOnly = "impersonation_read_only";
}
