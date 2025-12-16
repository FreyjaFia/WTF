using WTF.MAUI.Services;

namespace WTF.MAUI.Views;

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

        try
        {
            // Check if user is already logged in
            var isLoggedIn = await _authService.IsLoggedInAsync();

            if (isLoggedIn)
            {
                // Auto-login: Navigate to ContainerPage (which shows home by default)
                await Shell.Current.GoToAsync("//ContainerPage", false);
            }
            else
            {
                // Not logged in: Navigate to login page
                await Shell.Current.GoToAsync("//LoginPage", false);
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
                await Shell.Current.GoToAsync("//LoginPage", false);
            }
            catch (Exception fallbackEx)
            {
                System.Diagnostics.Debug.WriteLine($"Fallback navigation also failed: {fallbackEx.Message}");
            }
        }
    }
}
