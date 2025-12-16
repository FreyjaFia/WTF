using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class OrderPage : ContentPage
{
    private readonly OrderViewModel _viewModel;
    private readonly ContainerViewModel _containerViewModel;

    public OrderPage(OrderViewModel viewModel, ContainerViewModel containerViewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _containerViewModel = containerViewModel;
        
        BindingContext = _viewModel;
    }
}
