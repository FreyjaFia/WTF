using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Orders.Queries;
using WTF.MAUI.Services;

namespace WTF.MAUI.ViewModels
{
    public partial class OrderViewModel(IOrderService orderService) : ObservableObject
    {
        [ObservableProperty]
        private ObservableCollection<OrderDto> _orders = new();

        [ObservableProperty]
        private bool _isLoading;

        [ObservableProperty]
        private bool _isRefreshing = false;

        [ObservableProperty]
        private string? _errorMessage;

        [ObservableProperty]
        private string? _successMessage;

        [ObservableProperty]
        private OrderStatusEnum _selectedStatus = OrderStatusEnum.All;

        [ObservableProperty]
        private int _currentPage = 1;

        [ObservableProperty]
        private int _pageSize = 100;

        [ObservableProperty]
        [NotifyPropertyChangedFor(nameof(HasSearchText))]
        private string _searchText = string.Empty;

        public bool HasSearchText => !string.IsNullOrWhiteSpace(SearchText);

        private bool _isRefreshingInternal = false;
        private CancellationTokenSource? _searchCancellationTokenSource;

        [RelayCommand]
        private async Task LoadOrdersAsync()
        {
            if (IsLoading || IsRefreshing)
            {
                return;
            }

            IsLoading = true;

            await FetchOrdersAsync();

            IsLoading = false;
        }

        [RelayCommand]
        private async Task RefreshOrdersAsync()
        {
            if (IsRefreshing || IsLoading)
            {
                return;
            }

            try
            {
                _isRefreshingInternal = true;
                IsRefreshing = true;
                CurrentPage = 1;
                await FetchOrdersAsync();
            }
            finally
            {
                _isRefreshingInternal = false;
                IsRefreshing = false;
            }
        }

        private async Task FetchOrdersAsync()
        {
            ErrorMessage = null;
            SuccessMessage = null;

            try
            {
                // When searching, use All status to search across all statuses
                // When NOT searching, use the selected status filter
                var statusToFetch = !string.IsNullOrWhiteSpace(SearchText) 
                    ? OrderStatusEnum.All 
                    : SelectedStatus;

                var query = new GetOrdersQuery(
                    Page: CurrentPage,
                    PageSize: PageSize,
                    Status: (int)statusToFetch
                );

                var orders = await orderService.GetOrdersAsync(query);

                if (orders != null)
                {
                    var filteredOrders = orders.AsEnumerable();

                    // Apply search filter if text exists
                    if (!string.IsNullOrWhiteSpace(SearchText))
                    {
                        filteredOrders = filteredOrders.Where(o =>
                            o.OrderNumber.ToString().Contains(SearchText, StringComparison.OrdinalIgnoreCase));
                    }

                    // Order by most recent first
                    var orderedOrders = filteredOrders.OrderByDescending(o => o.OrderNumber);

                    Orders.Clear();
                    foreach (var order in orderedOrders)
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
        }

        [RelayCommand]
        private async Task FilterByStatusAsync(OrderStatusEnum status)
        {
            SelectedStatus = status;
            CurrentPage = 1;
            await LoadOrdersAsync();
        }

        [RelayCommand]
        private void ClearSearch()
        {
            SearchText = string.Empty;

            OnPropertyChanged(nameof(SearchText));
            OnPropertyChanged(nameof(HasSearchText));
        }

        [RelayCommand]
        private async Task ViewOrderDetailsAsync(OrderDto order)
        {
            if (order == null)
            {
                return;
            }

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
                var result = await Shell.Current.DisplayAlertAsync(
                    "Confirm Delete",
                    "Are you sure you want to delete this order?",
                    "Yes",
                    "No");

                if (!result)
                {
                    return;
                }

                IsLoading = true;
                var success = await orderService.DeleteOrderAsync(orderId);

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

        partial void OnIsRefreshingChanged(bool value)
        {
            if (value && !_isRefreshingInternal)
            {
                IsRefreshing = false;
            }
        }

        partial void OnSearchTextChanged(string value)
        {
            // Cancel previous search operation
            _searchCancellationTokenSource?.Cancel();
            _searchCancellationTokenSource = new CancellationTokenSource();

            // Debounce the search - wait 300ms after user stops typing
            Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(300, _searchCancellationTokenSource.Token);

                    // Trigger search after delay
                    await MainThread.InvokeOnMainThreadAsync(async () =>
                    {
                        CurrentPage = 1;
                        await LoadOrdersAsync();
                    });
                }
                catch (TaskCanceledException)
                {
                    // Search was cancelled, ignore
                }
            });
        }
    }
}
