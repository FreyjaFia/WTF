using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class OrderFormPage : ContentPage, IQueryAttributable
{
    private readonly OrderFormViewModel _viewModel;

    public OrderFormPage(OrderFormViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        // Handle navigation parameters
        if (query.TryGetValue("OrderId", out var orderIdObj) && orderIdObj is Guid orderId)
        {
            _viewModel.SetOrderId(orderId);
        }
        else
        {
            _viewModel.SetOrderId(null);
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _viewModel.InitializeAsync();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        _viewModel.CancelInitialization();
    }
}
