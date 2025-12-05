using WTF.MAUI.Services;

namespace WTF.MAUI.Views
{
    public partial class LoadingPage : ContentPage
    {
        private readonly IAuthService _authService;

        public LoadingPage(IAuthService authService)
        {
            InitializeComponent();
            _authService = authService;
        }

        protected override async void OnAppearing()
        {
            base.OnAppearing();

            // Small delay for smooth transition (like Facebook)
            await Task.Delay(500);

            // Check if user is already logged in
            var isLoggedIn = await _authService.IsLoggedInAsync();

            if (isLoggedIn)
            {
                // Auto-login: Navigate to main app
                await Shell.Current.GoToAsync("//OrderPage");
            }
            else
            {
                // Not logged in: Navigate to login page
                await Shell.Current.GoToAsync("//LoginPage");
            }
        }
    }
}
