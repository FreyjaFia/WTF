using WTF.MAUI.Services;
using WTF.MAUI.Navigation;

namespace WTF.MAUI.Views;

public partial class LoadingPage : ContentPage
{
    private readonly IAuthService _auth_service;

    public LoadingPage(IAuthService authService)
    {
        InitializeComponent();
        _auth_service = authService;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // Small delay for smooth transition (like Facebook)
        await Task.Delay(500);

        try
        {
            // Check if user is already logged in
            var isLoggedIn = await _auth_service.IsLoggedInAsync();

            if (isLoggedIn)
            {
                // Auto-login: Navigate to main app (new-order tab)
                await Shell.Current.GoToAsync($"//{Routes.NewOrder}", false);
            }
            else
            {
                // Not logged in: Navigate to login page
                await Shell.Current.GoToAsync($"//{Routes.Login}", false);
            }
        }
        catch (Exception ex)
        {
            // Log the error for debugging
            System.Diagnostics.Debug.WriteLine($"Navigation error in LoadingPage: {ex.Message}");
            System.Diagnostics.Debug.WriteLine($"Stack trace: {ex.StackTrace}");

            // Fallback to login on error
            try
            {
                await Shell.Current.GoToAsync($"//{Routes.Login}", false);
            }
            catch (Exception fallbackEx)
            {
                System.Diagnostics.Debug.WriteLine($"Fallback navigation also failed: {fallbackEx.Message}");
            }
        }
    }
}
