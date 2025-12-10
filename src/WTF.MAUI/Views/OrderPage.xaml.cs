using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class OrderPage : ContentPage, IInitializablePage
{
    private readonly OrderViewModel _viewModel;
    private readonly SidebarViewModel _sidebarViewModel;

    public OrderPage(OrderViewModel viewModel, SidebarViewModel sidebarViewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _sidebarViewModel = sidebarViewModel;
        
        // Set sidebar binding context first
        if (Content is SidebarLayout sidebar)
        {
            sidebar.BindingContext = _sidebarViewModel;
            // Set the page content's binding context to OrderViewModel
            if (sidebar.PageContent != null)
            {
                sidebar.PageContent.BindingContext = _viewModel;
            }
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        
        // Update sidebar current page
        _sidebarViewModel.CurrentPage = "OrderPage";
        
        // Load orders every time the page appears
        await _viewModel.InitializeAsync();
    }

    public void InitializePage()
    {
        // Call the same logic as OnAppearing, but synchronously
        _sidebarViewModel.CurrentPage = "OrderPage";
        _viewModel.InitializeAsync().ConfigureAwait(false);
    }
}
