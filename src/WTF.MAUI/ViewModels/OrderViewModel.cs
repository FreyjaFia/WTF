using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Orders.Queries;
using WTF.MAUI.Services;
using WTF.MAUI.Views;

namespace WTF.MAUI.ViewModels;

public partial class OrderViewModel : ObservableObject
{
    #region Fields

    private readonly IOrderService _orderService;
    private readonly ContainerViewModel _containerViewModel;
    private bool _isRefreshingInternal = false;
    private CancellationTokenSource? _searchCancellationTokenSource;

    #endregion

    #region Constructor

    public OrderViewModel(IOrderService orderService, ContainerViewModel containerViewModel)
    {
        _orderService = orderService;
        _containerViewModel = containerViewModel;
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private ObservableCollection<OrderDto> orders = new();

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    private bool isRefreshing;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string? successMessage;

    [ObservableProperty]
    private OrderStatusEnum selectedStatus = OrderStatusEnum.All;

    [ObservableProperty]
    private int currentPage = 1;

    [ObservableProperty]
    private int pageSize = 100;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSearchText))]
    private string searchText = string.Empty;

    #endregion

    #region Computed Properties

    public bool HasSearchText => !string.IsNullOrWhiteSpace(SearchText);

    #endregion

    #region Public Methods

    public async Task InitializeAsync()
    {
        await LoadOrdersAsync();
    }

    #endregion

    #region Commands

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
    private void AddOrder()
    {
        try
        {
            _containerViewModel.NavigateToOrderForm(null);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Error navigating to order form: {ex.Message}";
        }
    }

    [RelayCommand]
    private void ViewOrderDetails(OrderDto order)
    {
        if (order == null)
        {
            return;
        }

        try
        {
            _containerViewModel.NavigateToOrderForm(order.Id);
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

    #endregion

    #region Private Helper Methods

    private async Task FetchOrdersAsync()
    {
        ErrorMessage = null;
        SuccessMessage = null;

        try
        {
            var statusToFetch = !string.IsNullOrWhiteSpace(SearchText)
                ? OrderStatusEnum.All
                : SelectedStatus;

            var query = new GetOrdersQuery(
                Page: CurrentPage,
                PageSize: PageSize,
                Status: (int)statusToFetch
            );

            var orders = await _orderService.GetOrdersAsync(query);

            if (orders != null)
            {
                var filteredOrders = orders.AsEnumerable();

                if (!string.IsNullOrWhiteSpace(SearchText))
                {
                    filteredOrders = filteredOrders.Where(o =>
                        o.OrderNumber.ToString().Contains(SearchText, StringComparison.OrdinalIgnoreCase));
                }

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

    #endregion

    #region Partial Methods (Property Change Handlers)

    partial void OnIsRefreshingChanged(bool value)
    {
        if (value && !_isRefreshingInternal)
        {
            IsRefreshing = false;
        }
    }

    partial void OnSearchTextChanged(string value)
    {
        _searchCancellationTokenSource?.Cancel();
        _searchCancellationTokenSource = new CancellationTokenSource();

        Task.Run(async () =>
        {
            try
            {
                await Task.Delay(300, _searchCancellationTokenSource.Token);

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

    #endregion
}
