using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class OrderFormPage : ContentPage
{
    private readonly OrderFormViewModel _viewModel;
    private readonly ContainerViewModel _containerViewModel;

    public OrderFormPage(OrderFormViewModel viewModel, ContainerViewModel containerViewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _containerViewModel = containerViewModel;
        BindingContext = _viewModel;
    }
}
