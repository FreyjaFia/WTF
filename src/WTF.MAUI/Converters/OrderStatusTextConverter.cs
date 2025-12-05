using System.Globalization;
using WTF.Contracts.Orders.Enums;

namespace WTF.MAUI.Converters
{
    public class OrderStatusTextConverter : IValueConverter
    {
        public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            if (value is int statusInt)
            {
                var status = (OrderStatusEnum)statusInt;
                return status.ToString();
            }

            return "Unknown";
        }

        public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
