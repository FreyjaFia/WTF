using System.Security.Cryptography;

namespace WTF.Api.Features.Platform;

public static class TemporaryPassword
{
    // No 0/O/1/l/I so a password read out loud or from a screen is not mistyped.
    private const string Alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public const int Length = 16;

    public static string Generate()
    {
        var chars = new char[Length];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }

        return new string(chars);
    }
}
