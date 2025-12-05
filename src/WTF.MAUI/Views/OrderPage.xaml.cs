using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views
{
    public partial class OrderPage : ContentPage
    {
        private readonly OrderViewModel _viewModel;

        public OrderPage(OrderViewModel viewModel)
        {
            InitializeComponent();
            _viewModel = viewModel;
            BindingContext = _viewModel;
        }

        protected override async void OnAppearing()
        {
            base.OnAppearing();
            await _viewModel.InitializeAsync();
        }
    }
}
