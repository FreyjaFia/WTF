using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

[QueryProperty(nameof(OrderId), "orderId")]
public partial class OrderFormPage : ContentPage
{
    private readonly OrderFormViewModel _viewModel;
    private readonly SidebarViewModel _sidebarViewModel;

    public string? OrderId { get; set; }

    public OrderFormPage(OrderFormViewModel viewModel, SidebarViewModel sidebarViewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _sidebarViewModel = sidebarViewModel;
        
        // Set sidebar binding context first
        if (Content is SidebarLayout sidebar)
        {
            sidebar.BindingContext = _sidebarViewModel;
            // Set the page content's binding context to OrderFormViewModel
            if (sidebar.PageContent != null)
            {
                sidebar.PageContent.BindingContext = _viewModel;
            }
        }
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);

        // Update sidebar current page
        _sidebarViewModel.CurrentPage = "OrderPage";

        Guid? orderId = null;
        if (!string.IsNullOrEmpty(OrderId) && Guid.TryParse(OrderId, out var parsedOrderId))
        {
            orderId = parsedOrderId;
        }

        await _viewModel.InitializeAsync(orderId);
    }
}
