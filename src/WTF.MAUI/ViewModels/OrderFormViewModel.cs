using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using WTF.Contracts.OrderItems;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Enums;
using WTF.Contracts.Products.Queries;
using WTF.MAUI.Navigation;
using WTF.MAUI.Services;

namespace WTF.MAUI.ViewModels;

public partial class OrderFormViewModel : ObservableObject
{
    #region Fields

    private readonly IProductService _productService;
    private readonly IOrderService _orderService;
    private List<ProductDto> _allProducts = new();
    private CancellationTokenSource? _searchCancellationTokenSource;
    private CancellationTokenSource? _messageCancellationTokenSource;
    private CancellationTokenSource? _initCancellationTokenSource;

    #endregion

    #region Constructor

    public OrderFormViewModel(IProductService productService, IOrderService orderService)
    {
        _productService = productService;
        _orderService = orderService;

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

    // ProductViewModels is maintained manually to avoid relying on source-generator timing during build
    private ObservableCollection<ProductItemViewModel> _productViewModels = new();

    public ObservableCollection<ProductItemViewModel> ProductViewModels
    {
        get => _productViewModels;
        set => SetProperty(ref _productViewModels, value);
    }

    [ObservableProperty]
    private ObservableCollection<CartItemViewModel> cartItems = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEditMode))]
    [NotifyPropertyChangedFor(nameof(CanEditOrder))]
    [NotifyPropertyChangedFor(nameof(OrderTitle))]
    [NotifyPropertyChangedFor(nameof(ShowCartActions))]
    [NotifyPropertyChangedFor(nameof(ShowClearAllButton))]
    private OrderDto? existingOrder;

    [ObservableProperty]
    private Guid? orderId;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanCheckout))]
    private bool isLoading;

    [ObservableProperty]
    private bool isProductListLoading;

    [ObservableProperty]
    private bool isProcessing;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private string? successMessage;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSearchText))]
    private string searchText = string.Empty;

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

    public bool CanEditOrder => !IsEditMode || (ExistingOrder != null && ExistingOrder.Status == OrderStatusEnum.Pending);

    public string OrderTitle => IsEditMode && ExistingOrder != null ? $"Order #{ExistingOrder.OrderNumber}" : "New Order";

    public bool ShowCartActions => !(ExistingOrder != null && (
        ExistingOrder.Status == OrderStatusEnum.Done ||
        ExistingOrder.Status == OrderStatusEnum.Cancelled ||
        ExistingOrder.Status == OrderStatusEnum.ForDelivery));

    public bool ShowClearAllButton => HasCartItems && ShowCartActions;

    public bool HasSearchText => !string.IsNullOrWhiteSpace(SearchText);

    public bool CanCheckout => CanEditOrder && !IsLoading && HasCartItems;

    #endregion

    #region Public Methods

    public void SetOrderId(Guid? orderId)
    {
        OrderId = orderId;
    }

    public async Task InitializeAsync()
    {
        _initCancellationTokenSource?.Cancel();
        _initCancellationTokenSource = new CancellationTokenSource();
        var token = _initCancellationTokenSource.Token;

        try
        {
            await LoadProductsInternalAsync(token);

            if (OrderId.HasValue)
            {
                await LoadOrderInternalAsync(OrderId.Value, token);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when navigating away
        }
    }

    public void UpdateCartItemsCount()
    {
        CartItemsCount = CartItems.Sum(c => c.Quantity);
        OnPropertyChanged(nameof(Subtotal));
        OnPropertyChanged(nameof(Total));
        OnPropertyChanged(nameof(HasCartItems));
        OnPropertyChanged(nameof(ShowClearAllButton));
        OnPropertyChanged(nameof(CanCheckout));
    }

    public void CancelInitialization()
    {
        _initCancellationTokenSource?.Cancel();
        _searchCancellationTokenSource?.Cancel();
        _messageCancellationTokenSource?.Cancel();
    }

    #endregion

    #region Commands

    [RelayCommand]
    private async Task LoadProductsAsync()
    {
        await LoadProductsInternalAsync(CancellationToken.None);
    }

    [RelayCommand]
    private async Task LoadOrderAsync(Guid orderId)
    {
        await LoadOrderInternalAsync(orderId, CancellationToken.None);
    }

    [RelayCommand]
    private void AddToCart(ProductItemViewModel productItem)
    {
        if (productItem == null || !CanEditOrder)
        {
            return;
        }

        var existingItem = CartItems.FirstOrDefault(c => c.Product.Id == productItem.Id);

        if (existingItem != null)
        {
            existingItem.Quantity++;
        }
        else
        {
            var newCartItem = new CartItemViewModel(productItem.Product, this);
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
    private void FilterByProductType(ProductTypeEnum? productType)
    {
        SelectedProductType = productType;
        ApplyFilters();
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
                    await Shell.Current.GoToAsync($"//{Routes.Orders}");
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
                    Status = OrderStatusEnum.Pending,
                    Items = orderItems
                };

                var result = await _orderService.CreateOrderAsync(createCommand);

                if (result != null)
                {
                    ShowTemporarySuccess($"Order #{result.OrderNumber} created successfully!");
                    await Task.Delay(1500);
                    await Shell.Current.GoToAsync($"//{Routes.Orders}");
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

        await Shell.Current.GoToAsync($"//{Routes.Orders}");
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

    private async Task LoadProductsInternalAsync(CancellationToken token)
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            IsProductListLoading = true;
            ErrorMessage = null;
        });

        try
        {
            var query = new GetProductsQuery
            {
                Page = 1,
                PageSize = 1000,
                IsActive = true
            };

            var result = await _productService.GetProductsAsync(query);

            if (token.IsCancellationRequested)
            {
                return;
            }

            if (result?.Products != null && result.Products.Any())
            {
                _allProducts = result.Products;
                ApplyFilters();
            }
            else
            {
                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    _allProducts = new List<ProductDto>();
                    ProductViewModels = new ObservableCollection<ProductItemViewModel>();
                    Products = new ObservableCollection<ProductDto>();
                    ShowTemporaryError("No products found. Please add products first.");
                });
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                _allProducts = new List<ProductDto>();
                ProductViewModels = new ObservableCollection<ProductItemViewModel>();
                Products = new ObservableCollection<ProductDto>();
                ShowTemporaryError($"Error loading products: {ex.Message}");
            });
        }
        finally
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                IsProductListLoading = false;
            });
        }
    }

    private async Task LoadOrderInternalAsync(Guid orderId, CancellationToken token)
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            IsLoading = true;
            ErrorMessage = null;
        });

        try
        {
            var order = await Task.Run(() => _orderService.GetOrderByIdAsync(orderId), token)
                                   .ConfigureAwait(false);

            if (token.IsCancellationRequested)
            {
                return;
            }

            if (order != null)
            {
                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    ExistingOrder = order;
                    await PopulateCartFromOrder(order);
                    OnPropertyChanged(nameof(CanEditOrder));
                    OnPropertyChanged(nameof(OrderTitle));
                    OnPropertyChanged(nameof(ShowCartActions));
                    OnPropertyChanged(nameof(ShowClearAllButton));

                    if (!CanEditOrder)
                    {
                        ShowTemporaryError("This order cannot be edited because it's not in pending status.");
                    }
                });
            }
            else
            {
                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    ShowTemporaryError("Order not found.");
                });
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                ShowTemporaryError($"Error loading order: {ex.Message}");
            });
        }
        finally
        {
            await MainThread.InvokeOnMainThreadAsync(() => IsLoading = false);
        }
    }

    private void ApplyFilters()
    {
        if (_allProducts == null || !_allProducts.Any())
        {
            MainThread.BeginInvokeOnMainThread(() =>
            {
                Products = new ObservableCollection<ProductDto>();
                ProductViewModels = new ObservableCollection<ProductItemViewModel>();
            });
            return;
        }

        var filtered = _allProducts.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            filtered = filtered.Where(p => p.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase));
        }

        if (SelectedProductType.HasValue)
        {
            filtered = filtered.Where(p => p.Type == SelectedProductType.Value);
        }

        var finalList = filtered.ToList();
        var vmList = finalList.Select(p => new ProductItemViewModel(p)).ToList();

        MainThread.BeginInvokeOnMainThread(() =>
        {
            Products = new ObservableCollection<ProductDto>(finalList);
            ProductViewModels = new ObservableCollection<ProductItemViewModel>(vmList);
        });
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
        var token = _searchCancellationTokenSource.Token;

        Task.Run(async () =>
        {
            try
            {
                await Task.Delay(300, token);

                if (!token.IsCancellationRequested)
                {
                    ApplyFilters();
                }
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
        var token = _messageCancellationTokenSource.Token;

        Task.Run(async () =>
        {
            try
            {
                await Task.Delay(3000, token);

                if (!token.IsCancellationRequested)
                {
                    await MainThread.InvokeOnMainThreadAsync(() =>
                    {
                        ErrorMessage = null;
                        SuccessMessage = null;
                    });
                }
            }
            catch (TaskCanceledException)
            {
                // Message dismissal was cancelled, ignore
            }
        });
    }

    #endregion
}
