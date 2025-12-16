using System.Globalization;
using WTF.Contracts.Products.Enums;

namespace WTF.MAUI.Converters;

public class ProductTypeIconConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is ProductTypeEnum productType)
        {
            return productType switch
            {
                ProductTypeEnum.Drink => "\ue541",      // &#xe541; - local_cafe (coffee cup)
                ProductTypeEnum.Food => "\uea64",       // &#xea64; - restaurant
                ProductTypeEnum.Dessert => "\ue7ef",    // &#xe7ef; - cake
                ProductTypeEnum.Other => "\ue8f4",      // &#xe8f4; - store
                _ => "\ue8d1"                           // &#xe8d1; - category
            };
        }

        return "\ue8d1"; // category icon as default
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }
}
