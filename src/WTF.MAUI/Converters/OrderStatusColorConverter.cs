using System.Globalization;
using WTF.Contracts.Orders.Enums;

namespace WTF.MAUI.Converters
{
    public class OrderStatusColorConverter : IValueConverter
    {
        public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            if (value is int statusInt)
            {
                var status = (OrderStatusEnum)statusInt;
                return status switch
                {
                    OrderStatusEnum.Pending => Color.FromArgb("#FFA726"),
                    OrderStatusEnum.Preparing => Color.FromArgb("#42A5F5"),
                    OrderStatusEnum.Ready => Color.FromArgb("#66BB6A"),
                    OrderStatusEnum.Completed => Color.FromArgb("#26A69A"),
                    OrderStatusEnum.Cancelled => Color.FromArgb("#EF5350"),
                    _ => Color.FromArgb("#9E9E9E")
                };
            }
            return Color.FromArgb("#9E9E9E");
        }

        public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
