using System.Globalization;
using WTF.Contracts.Products.Enums;

namespace WTF.MAUI.Converters;

public class ProductTypeButtonBackgroundConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var selectedType = value as ProductTypeEnum?;
        var buttonType = parameter?.ToString();

        if (buttonType == "All" && selectedType == null)
        {
            return Color.FromArgb("#1F1F1F");
        }

        if (buttonType != "All" && parameter is ProductTypeEnum paramType && selectedType == paramType)
        {
            return Color.FromArgb("#1F1F1F");
        }

        return Color.FromArgb("#FCF8F1");
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
