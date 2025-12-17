using WTF.MAUI.Navigation;
using WTF.MAUI.Services;
using WTF.MAUI.Views;

namespace WTF.MAUI;

public partial class AppShell : Shell
{
    private readonly IAuthService _authService;

    public AppShell(IAuthService authService)
    {
        InitializeComponent();
        _authService = authService;

        // Register route for editing orders (passing order ID)
        Routing.RegisterRoute(Routes.EditOrder, typeof(OrderFormPage));
    }

    private async void OnLogoutTapped(object? sender, EventArgs e)
    {
        var result = await DisplayAlertAsync("Logout", "Are you sure you want to logout?", "Yes", "No");
        if (result)
        {
            _authService.Logout();
            await _authService.RequireLoginAsync();
        }
    }
}
