using System.Text.RegularExpressions;

namespace WTF.Api.Features.Branches;

public static partial class BranchCodes
{
    public const int MinLength = 2;
    public const int MaxLength = 5;

    public static string FromShopName(string shopName)
    {
        var letters = new string(shopName.Where(char.IsAsciiLetter).Take(3).ToArray()).ToUpperInvariant();
        return letters.Length >= MinLength ? letters : "MAIN";
    }

    public static string Normalize(string? code)
    {
        return (code ?? string.Empty).Trim().ToUpperInvariant();
    }

    public static bool IsValid(string code)
    {
        return CodePattern().IsMatch(code);
    }

    [GeneratedRegex("^[A-Z0-9]{2,5}$")]
    private static partial Regex CodePattern();
}
