using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Enums;
using WTF.Contracts.Products.Queries;
using WTF.MAUI.Services;

namespace WTF.MAUI.ViewModels;

public partial class OrderFormViewModel : ObservableObject
{
    #region Fields

    private readonly IProductService _productService;
    private readonly IOrderService _orderService;
    private readonly ContainerViewModel _containerViewModel;
    private List<ProductDto> _allProducts = new();
    private CancellationTokenSource? _searchCancellationTokenSource;
    private CancellationTokenSource? _messageCancellationTokenSource;

    #endregion

    #region Constructor

    public OrderFormViewModel(IProductService productService, IOrderService orderService, ContainerViewModel containerViewModel)
    {
        _productService = productService;
        _orderService = orderService;
        _containerViewModel = containerViewModel;
        
        PropertyChanged += (s, e) =>
        {
            if (e.PropertyName == nameof(SearchText))
            {
                HandleSearchTextChanged();
            }
        };
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private ObservableCollection<ProductDto> products = new();

    [ObservableProperty]
    private ObservableCollection<CartItemViewModel> cartItems = new();

    [ObservableProperty]
    private OrderDto? existingOrder;

    [ObservableProperty]
    private Guid? orderId;

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    private bool isProcessing;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string? successMessage;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSearchText))]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private ProductTypeEnum? selectedProductType;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal), nameof(Total), nameof(HasCartItems))]
    private int cartItemsCount;

    #endregion

    #region Computed Properties

    public decimal Subtotal => CartItems.Sum(item => item.Subtotal);

    public decimal Total => Subtotal;

    public bool HasCartItems => CartItems.Any();

    public bool IsEditMode => ExistingOrder != null;

    public bool HasSearchText => !string.IsNullOrWhiteSpace(SearchText);

    public bool CanEditOrder => !IsEditMode || (ExistingOrder != null && ExistingOrder.Status == 1);

    public string OrderTitle => IsEditMode && ExistingOrder != null 
        ? $"Order #{ExistingOrder.OrderNumber}" 
        : "New Order";

    #endregion

    #region Public Methods

    public async Task InitializeAsync(Guid? orderId = null)
    {
        // Update container current page
        _containerViewModel.CurrentPage = "OrderPage";
        
        OrderId = orderId;
        await LoadProductsAsync();

        if (orderId.HasValue)
        {
            await LoadOrderAsync(orderId.Value);
        }
    }

    public void UpdateCartItemsCount()
    {
        CartItemsCount = CartItems.Sum(c => c.Quantity);
        OnPropertyChanged(nameof(Subtotal));
        OnPropertyChanged(nameof(Total));
        OnPropertyChanged(nameof(HasCartItems));
    }

    #endregion

    #region Commands

    [RelayCommand]
    private async Task LoadProductsAsync()
    {
        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var query = new GetProductsQuery
            {
                Page = 1,
                PageSize = 1000,
                IsActive = true
            };

            var result = await _productService.GetProductsAsync(query);

            if (result?.Products != null)
            {
                _allProducts = result.Products;
                ApplyFilters();
            }
            else
            {
                ShowTemporaryError("Failed to load products. Please try again.");
            }
        }
        catch (Exception ex)
        {
            ShowTemporaryError($"Error loading products: {ex.Message}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task LoadOrderAsync(Guid orderId)
    {
        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var order = await _orderService.GetOrderByIdAsync(orderId);

            if (order != null)
            {
                ExistingOrder = order;
                await PopulateCartFromOrder(order);
                OnPropertyChanged(nameof(CanEditOrder));
                OnPropertyChanged(nameof(OrderTitle));
                
                if (!CanEditOrder)
                {
                    ShowTemporaryError("This order cannot be edited because it's not in pending status.");
                }
            }
            else
            {
                ShowTemporaryError("Order not found.");
            }
        }
        catch (Exception ex)
        {
            ShowTemporaryError($"Error loading order: {ex.Message}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void AddToCart(ProductDto product)
    {
        if (product == null || !CanEditOrder)
        {
            return;
        }

        var existingItem = CartItems.FirstOrDefault(c => c.Product.Id == product.Id);

        if (existingItem != null)
        {
            existingItem.Quantity++;
        }
        else
        {
            var newCartItem = new CartItemViewModel(product, this);
            CartItems.Add(newCartItem);
        }

        UpdateCartItemsCount();
    }

    [RelayCommand]
    private void RemoveFromCart(CartItemViewModel cartItem)
    {
        if (cartItem != null && CartItems.Contains(cartItem))
        {
            CartItems.Remove(cartItem);
            UpdateCartItemsCount();
        }
    }

    [RelayCommand]
    private async Task ClearCartAsync()
    {
        if (!HasCartItems)
        {
            return;
        }

        var result = await Shell.Current.DisplayAlertAsync(
            "Clear Cart",
            "Are you sure you want to remove all items from the cart?",
            "Yes",
            "No");

        if (result)
        {
            CartItems.Clear();
            UpdateCartItemsCount();
        }
    }

    [RelayCommand]
    private async Task FilterByProductType(ProductTypeEnum? productType)
    {
        IsLoading = true;

        SelectedProductType = productType;

        // Yield so UI can update and show loading indicator
        await Task.Yield();

        ApplyFilters();

        IsLoading = false;
    }

    [RelayCommand]
    private void ClearSearch()
    {
        SearchText = string.Empty;
    }

    [RelayCommand]
    private async Task CheckoutAsync()
    {
        if (!HasCartItems)
        {
            ShowTemporaryError("Cart is empty. Please add items before checkout.");
            return;
        }

        if (!CanEditOrder)
        {
            ShowTemporaryError("This order cannot be modified.");
            return;
        }

        IsProcessing = true;
        ErrorMessage = null;
        SuccessMessage = null;

        try
        {
            var orderItems = CartItems.Select(item => new OrderItemDto(
                Id: Guid.NewGuid(),
                ProductId: item.Product.Id,
                Quantity: item.Quantity
            )).ToList();

            if (IsEditMode && ExistingOrder != null)
            {
                var updateCommand = new UpdateOrderCommand
                {
                    Id = ExistingOrder.Id,
                    CustomerId = ExistingOrder.CustomerId,
                    Status = ExistingOrder.Status,
                    Items = orderItems
                };

                var result = await _orderService.UpdateOrderAsync(updateCommand);

                if (result != null)
                {
                    ShowTemporarySuccess("Order updated successfully!");
                    await Task.Delay(1500);
                    await Shell.Current.GoToAsync("..");
                }
                else
                {
                    ShowTemporaryError("Failed to update order. Please try again.");
                }
            }
            else
            {
                var createCommand = new CreateOrderCommand
                {
                    CustomerId = null,
                    Status = 1,
                    Items = orderItems
                };

                var result = await _orderService.CreateOrderAsync(createCommand);

                if (result != null)
                {
                    ShowTemporarySuccess($"Order #{result.OrderNumber} created successfully!");
                    await Task.Delay(1500);
                    await Shell.Current.GoToAsync("..");
                }
                else
                {
                    ShowTemporaryError("Failed to create order. Please try again.");
                }
            }
        }
        catch (Exception ex)
        {
            ShowTemporaryError($"Error processing order: {ex.Message}");
        }
        finally
        {
            IsProcessing = false;
        }
    }

    [RelayCommand]
    private async Task CancelAsync()
    {
        if (HasCartItems)
        {
            var result = await Shell.Current.DisplayAlertAsync(
                "Discard Changes",
                "Are you sure you want to discard this order?",
                "Yes",
                "No");

            if (!result)
            {
                return;
            }
        }

        // Use container view model navigation to go back to orders page
        try
        {
            _containerViewModel.NavigateToOrdersPage();
        }
        catch (Exception)
        {
            // Fallback to Shell navigation if container navigation fails
            await Shell.Current.GoToAsync("..");
        }
    }

    [RelayCommand]
    private void ClearError()
    {
        ErrorMessage = null;
        _messageCancellationTokenSource?.Cancel();
    }

    [RelayCommand]
    private void ClearSuccess()
    {
        SuccessMessage = null;
        _messageCancellationTokenSource?.Cancel();
    }

    #endregion

    #region Private Helper Methods

    private void ApplyFilters()
    {
        var filtered = _allProducts.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            filtered = filtered.Where(p =>
                p.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase));
        }

        if (SelectedProductType.HasValue)
        {
            filtered = filtered.Where(p => p.Type == SelectedProductType.Value);
        }

        Products.Clear();
        foreach (var product in filtered)
        {
            Products.Add(product);
        }
    }

    private async Task PopulateCartFromOrder(OrderDto order)
    {
        CartItems.Clear();

        foreach (var item in order.Items)
        {
            var product = await _productService.GetProductByIdAsync(item.ProductId);
            if (product != null)
            {
                var cartItem = new CartItemViewModel(product, this);
                cartItem.Quantity = item.Quantity;
                CartItems.Add(cartItem);
            }
        }

        UpdateCartItemsCount();
    }

    private void HandleSearchTextChanged()
    {
        _searchCancellationTokenSource?.Cancel();
        _searchCancellationTokenSource = new CancellationTokenSource();

        Task.Run(async () =>
        {
            try
            {
                await Task.Delay(300, _searchCancellationTokenSource.Token);

                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    ApplyFilters();
                });
            }
            catch (TaskCanceledException)
            {
                // Search was cancelled, ignore
            }
        });
    }

    private void ShowTemporaryError(string message)
    {
        ErrorMessage = message;
        AutoDismissMessage();
    }

    private void ShowTemporarySuccess(string message)
    {
        SuccessMessage = message;
        AutoDismissMessage();
    }

    private void AutoDismissMessage()
    {
        _messageCancellationTokenSource?.Cancel();
        _messageCancellationTokenSource = new CancellationTokenSource();

        Task.Run(async () =>
        {
            try
            {
                await Task.Delay(3000, _messageCancellationTokenSource.Token);

                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    ErrorMessage = null;
                    SuccessMessage = null;
                });
            }
            catch (TaskCanceledException)
            {
                // Message dismissal was cancelled, ignore
            }
        });
    }

    #endregion
}
