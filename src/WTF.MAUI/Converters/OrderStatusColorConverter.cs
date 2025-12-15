using System.Globalization;
using WTF.Contracts.Orders.Enums;

namespace WTF.MAUI.Converters
{
    public class OrderStatusColorConverter : IValueConverter
    {
        public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            if (value is not OrderStatusEnum status)
            {
                return Color.FromArgb("#9E9E9E");
            }

            return status switch
            {
                OrderStatusEnum.Pending => Color.FromArgb("#FFA726"),
                OrderStatusEnum.ForDelivery => Color.FromArgb("#26A69A"),
                OrderStatusEnum.Done => Color.FromArgb("#66BB6A"),
                OrderStatusEnum.Cancelled => Color.FromArgb("#EF5350"),
                _ => Color.FromArgb("#9E9E9E"),
            };
        }

        public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
