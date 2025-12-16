using System.Globalization;
using System.Text.RegularExpressions;
using WTF.Contracts.Orders.Enums;

namespace WTF.MAUI.Converters
{
    public class OrderStatusTextConverter : IValueConverter
    {
        public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            if (value is not OrderStatusEnum status)
            {
                return "Unknown";
            }

            var statusText = status.ToString();
            // Add spaces before capital letters (except the first one)
            // ForDelivery -> For Delivery
            return Regex.Replace(statusText, "(?<!^)([A-Z])", " $1");
        }

        public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
