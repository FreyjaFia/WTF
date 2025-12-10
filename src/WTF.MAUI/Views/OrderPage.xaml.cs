using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class OrderPage : ContentPage, IInitializablePage
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

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        
        // Update container current page
        _containerViewModel.CurrentPage = "OrderPage";
        
        await _viewModel.InitializeAsync();
    }

    public async void InitializePage()
    {
        // Update container current page
        _containerViewModel.CurrentPage = "OrderPage";
        
        await _viewModel.InitializeAsync();
    }
}
