using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Orders.Queries;
using WTF.MAUI.Services;

namespace WTF.MAUI.ViewModels
{
    public partial class OrderViewModel : ObservableObject
    {
        private readonly IOrderService _orderService;

        [ObservableProperty]
        private ObservableCollection<OrderDto> _orders = new();

        [ObservableProperty]
        private bool _isLoading;

        [ObservableProperty]
        private bool _isRefreshing;

        [ObservableProperty]
        private string? _errorMessage;

        [ObservableProperty]
        private string? _successMessage;

        [ObservableProperty]
        private OrderStatusEnum _selectedStatus = OrderStatusEnum.Pending;

        [ObservableProperty]
        private int _currentPage = 1;

        [ObservableProperty]
        private int _pageSize = 10;

        public OrderViewModel(IOrderService orderService)
        {
            _orderService = orderService;
        }

        [RelayCommand]
        private async Task LoadOrdersAsync()
        {
            if (IsLoading) return;

            IsLoading = true;
            ErrorMessage = null;
            SuccessMessage = null;

            try
            {
                var query = new GetOrdersQuery(
                    Page: CurrentPage,
                    PageSize: PageSize,
                    Status: (int)SelectedStatus
                );

                var orders = await _orderService.GetOrdersAsync(query);

                if (orders != null)
                {
                    Orders.Clear();
                    foreach (var order in orders)
                    {
                        Orders.Add(order);
                    }
                }
                else
                {
                    ErrorMessage = "Failed to load orders. Please try again.";
                }
            }
            catch (Exception ex)
            {
                ErrorMessage = $"Error: {ex.Message}";
            }
            finally
            {
                IsLoading = false;
            }
        }

        [RelayCommand]
        private async Task RefreshOrdersAsync()
        {
            if (IsRefreshing) return;

            IsRefreshing = true;
            ErrorMessage = null;
            SuccessMessage = null;

            try
            {
                CurrentPage = 1;
                await LoadOrdersAsync();
            }
            finally
            {
                IsRefreshing = false;
            }
        }

        [RelayCommand]
        private async Task FilterByStatusAsync(OrderStatusEnum status)
        {
            SelectedStatus = status;
            CurrentPage = 1;
            await LoadOrdersAsync();
        }

        [RelayCommand]
        private async Task ViewOrderDetailsAsync(OrderDto order)
        {
            if (order == null) return;

            try
            {
                await Shell.Current.GoToAsync($"//orderdetails?orderId={order.Id}");
            }
            catch (Exception ex)
            {
                ErrorMessage = $"Error navigating to order details: {ex.Message}";
            }
        }

        [RelayCommand]
        private async Task DeleteOrderAsync(Guid orderId)
        {
            try
            {
                var result = await Shell.Current.DisplayAlert(
                    "Confirm Delete",
                    "Are you sure you want to delete this order?",
                    "Yes",
                    "No");

                if (!result) return;

                IsLoading = true;
                var success = await _orderService.DeleteOrderAsync(orderId);

                if (success)
                {
                    SuccessMessage = "Order deleted successfully!";
                    await LoadOrdersAsync();
                }
                else
                {
                    ErrorMessage = "Failed to delete order. Please try again.";
                }
            }
            catch (Exception ex)
            {
                ErrorMessage = $"Error deleting order: {ex.Message}";
            }
            finally
            {
                IsLoading = false;
            }
        }

        public async Task InitializeAsync()
        {
            await LoadOrdersAsync();
        }
    }
}
