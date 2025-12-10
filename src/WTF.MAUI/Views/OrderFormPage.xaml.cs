using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

[QueryProperty(nameof(OrderId), "orderId")]
public partial class OrderFormPage : ContentPage, IInitializablePage
{
    private readonly OrderFormViewModel _viewModel;
    private readonly ContainerViewModel _containerViewModel;
    private Guid? _orderIdToLoad;

    public string? OrderId { get; set; }

    public OrderFormPage(OrderFormViewModel viewModel, ContainerViewModel containerViewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _containerViewModel = containerViewModel;
        BindingContext = _viewModel;
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);

        Guid? orderId = null;
        if (!string.IsNullOrEmpty(OrderId) && Guid.TryParse(OrderId, out var parsedOrderId))
        {
            orderId = parsedOrderId;
        }

        await _viewModel.InitializeAsync(orderId);
    }

    public async void InitializePage()
    {
        // Update container current page
        _containerViewModel.CurrentPage = "OrderFormPage";
        
        // Initialize is handled by LoadPageContentWithParameter in ContainerViewModel
    }
}
