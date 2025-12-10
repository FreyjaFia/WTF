using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.Contracts.Products;

namespace WTF.MAUI.ViewModels;

public partial class CartItemViewModel : ObservableObject
{
    #region Fields

    private readonly OrderFormViewModel _parentViewModel;

    #endregion

    #region Constructor

    public CartItemViewModel(ProductDto product, OrderFormViewModel parentViewModel)
    {
        _product = product;
        _parentViewModel = parentViewModel;
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private ProductDto _product;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal))]
    private int _quantity = 1;

    #endregion

    #region Computed Properties

    public decimal Subtotal => Product.Price * Quantity;

    #endregion

    #region Commands

    [RelayCommand]
    private void IncreaseQuantity()
    {
        Quantity++;
        _parentViewModel.UpdateCartItemsCount();
    }

    [RelayCommand]
    private void DecreaseQuantity()
    {
        if (Quantity > 1)
        {
            Quantity--;
            _parentViewModel.UpdateCartItemsCount();
        }
        else
        {
            _parentViewModel.RemoveFromCartCommand.Execute(this);
        }
    }

    #endregion
}
