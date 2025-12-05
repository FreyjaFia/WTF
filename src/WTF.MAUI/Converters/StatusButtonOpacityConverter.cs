using System.Globalization;
using WTF.Contracts.Orders.Enums;

namespace WTF.MAUI.Converters
{
    public class StatusButtonOpacityConverter : IValueConverter
    {
        public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            if (value is not OrderStatusEnum selectedStatus)
            {
                return 0.5;
            }

            // Handle "All" button
            if (parameter is string strParam && strParam == "All")
            {
                return selectedStatus == OrderStatusEnum.All ? 1.0 : 0.5;
            }

            // Handle enum parameter from static markup
            if (parameter is OrderStatusEnum buttonStatus)
            {
                return selectedStatus == buttonStatus ? 1.0 : 0.5;
            }

            // Default to dimmed
            return 0.5;
        }

        public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
