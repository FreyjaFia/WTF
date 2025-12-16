using System.Globalization;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Enums;
using WTF.MAUI.Settings;
using Microsoft.Maui.Controls;

namespace WTF.MAUI.Converters;

public class ProductImageUrlConverter : IValueConverter
{
    private static WtfSettings? _settings;

    public static void Initialize(WtfSettings settings)
    {
        _settings = settings;
    }

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string imageUrl || _settings == null)
        {
            // No image -> return null so the Label fallback is shown via IsNotNullConverter bindings
            return null;
        }

        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return null;
        }

        try
        {
            // Remove any leading slash from ImageUrl to avoid double slashes
            var cleanImageUrl = imageUrl.TrimStart('/');
            var baseUrl = _settings.BaseUrl.TrimEnd('/');
            var fullUrl = new Uri($"{baseUrl}/{cleanImageUrl}");

            // Use UriImageSource with caching enabled
            return new UriImageSource
            {
                Uri = fullUrl,
                CachingEnabled = true,
                CacheValidity = TimeSpan.FromDays(7)
            };
        }
        catch
        {
            return null;
        }
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotImplementedException();
    }

    private static string GetPlaceholderIcon(ProductTypeEnum productType)
    {
        return productType switch
        {
            ProductTypeEnum.Drink => "\uef35", // coffee icon
            ProductTypeEnum.Food => "\ue56c", // restaurant icon
            ProductTypeEnum.Dessert => "\ue7f1", // cake icon
            _ => "\uef35" // default coffee icon
        };
    }
}
