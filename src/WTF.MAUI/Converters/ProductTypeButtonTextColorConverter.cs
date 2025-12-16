using System.Globalization;
using WTF.Contracts.Products.Enums;

namespace WTF.MAUI.Converters;

public class ProductTypeButtonTextColorConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var selectedType = value as ProductTypeEnum?;
        var buttonType = parameter?.ToString();

        if (buttonType == "All" && selectedType == null)
        {
            return Color.FromArgb("#FFFFFF");
        }

        if (buttonType != "All" && parameter is ProductTypeEnum paramType && selectedType == paramType)
        {
            return Color.FromArgb("#FFFFFF");
        }

        return Color.FromArgb("#000000");
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
