using System.Globalization;
using WTF.Contracts.Products.Enums;

namespace WTF.MAUI.Converters;

public class ProductTypeColorConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is ProductTypeEnum productType)
        {
            return productType switch
            {
                ProductTypeEnum.Drink => Color.FromArgb("#2196F3"),
                ProductTypeEnum.Food => Color.FromArgb("#FF9800"),
                ProductTypeEnum.Dessert => Color.FromArgb("#E91E63"),
                ProductTypeEnum.Other => Color.FromArgb("#9C27B0"),
                _ => Color.FromArgb("#607D8B")
            };
        }

        return Color.FromArgb("#607D8B");
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
