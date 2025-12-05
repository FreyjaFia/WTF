using WTF.MAUI.Services;

namespace WTF.MAUI
{
    public partial class MainPage : ContentPage
    {
        private readonly IAuthService _authService;

        public MainPage(IAuthService authService)
        {
            _authService = authService;

            InitializeComponent();
        }

        private async void OnLogoutClicked(object sender, EventArgs e)
        {
            _authService.Logout();

            await _authService.RequireLoginAsync();
        }
    }
}
