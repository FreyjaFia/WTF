using System.Globalization;

namespace WTF.MAUI.Converters;

public class PageTitleConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is bool isEditMode)
        {
            return isEditMode ? "Edit Order" : "New Order";
        }
        return "New Order";
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
