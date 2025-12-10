using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.Contracts.Orders;

namespace WTF.MAUI.ViewModels;

public partial class OrderFormViewModel : ObservableObject
{
    #region Fields
    #endregion

    #region Constructor

    public OrderFormViewModel()
    {
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private OrderDto? order;

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    private string? errorMessage;

    #endregion

    #region Computed Properties
    #endregion

    #region Public Methods
    #endregion

    #region Commands

    [RelayCommand]
    public async Task LoadOrderAsync(Guid orderId)
    {
        // TODO: Load order details from service
        IsLoading = true;
        await Task.Delay(200); // Placeholder for async call
        // Set Order = ...
        IsLoading = false;
    }

    #endregion

    #region Private Helper Methods
    #endregion

    #region Partial Methods (Property Change Handlers)
    #endregion
}
