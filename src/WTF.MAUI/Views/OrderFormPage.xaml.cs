using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

[QueryProperty(nameof(OrderId), "orderId")]
public partial class OrderFormPage : ContentPage
{
    private readonly OrderFormViewModel _viewModel;
    private bool _isExpanded = false;

    public string? OrderId { get; set; }

    public OrderFormPage(OrderFormViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;

        // Tap anywhere on footer bar to toggle sheet
        var tapGesture = new TapGestureRecognizer();
        tapGesture.Tapped += (s, e) => ToggleBottomSheet();
        // Attach to footer bar
        FooterBar.GestureRecognizers.Add(tapGesture);
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);

        if (!string.IsNullOrEmpty(OrderId) && Guid.TryParse(OrderId, out var orderId))
        {
            await _viewModel.LoadOrderAsync(orderId);
        }
    }

    private async void ToggleBottomSheet()
    {
        if (_isExpanded)
        {
            // Collapse
            await BottomSheet.TranslateTo(0, 300, 250, Easing.CubicOut);
            _isExpanded = false;
        }
        else
        {
            // Expand
            await BottomSheet.TranslateTo(0, 0, 250, Easing.CubicOut);
            _isExpanded = true;
        }
    }
}
