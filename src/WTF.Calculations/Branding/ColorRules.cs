using System.Globalization;

namespace WTF.Calculations.Branding;

public static class ColorRules
{
    // White text on the shop's colour must stay readable (WCAG AA for normal text).
    public const double MinimumContrastWithWhite = 4.5;

    public static bool TryParseHex(string? value, out (int R, int G, int B) rgb)
    {
        rgb = default;
        if (value is not { Length: 7 } || value[0] != '#'
            || !int.TryParse(value.AsSpan(1), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var packed))
        {
            return false;
        }

        rgb = ((packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF);
        return true;
    }

    public static double ContrastWithWhite(int r, int g, int b)
    {
        var luminance = (0.2126 * Channel(r)) + (0.7152 * Channel(g)) + (0.0722 * Channel(b));
        return 1.05 / (luminance + 0.05);
    }

    public static bool IsReadableWithWhiteText(string? hex) =>
        TryParseHex(hex, out var c) && ContrastWithWhite(c.R, c.G, c.B) >= MinimumContrastWithWhite;

    private static double Channel(int value)
    {
        var s = value / 255.0;
        return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
    }
}
