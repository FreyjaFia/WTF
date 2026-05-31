namespace WTF.Api.Features.Users;

internal static class UserValidation
{
    public static void EnsureValidUsername(string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            throw new InvalidOperationException("Username is required.");
        }
    }

    public static void EnsureValidPassword(string? password, bool isUpdate = false)
    {
        if (!isUpdate && string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException("Password is required.");
        }
    }
}
