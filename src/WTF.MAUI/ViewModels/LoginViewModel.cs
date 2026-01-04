using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.MAUI.Services;
using WTF.MAUI.Navigation;

namespace WTF.MAUI.ViewModels;

public partial class LoginViewModel : ObservableObject
{
    #region Fields

    private readonly IAuthService _authService;

    #endregion

    #region Constructor

    public LoginViewModel(IAuthService authService)
    {
        _authService = authService;
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private string username = string.Empty;

    [ObservableProperty]
    private string password = string.Empty;

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    private string? errorMessage;

    [ObservableProperty]
    private bool rememberMe;

    #endregion

    #region Commands

    [RelayCommand]
    private async Task LoginAsync()
    {
        if (IsLoading)
        {
            return;
        }

        // Validate inputs
        if (string.IsNullOrWhiteSpace(Username))
        {
            ErrorMessage = "Username is required";
            return;
        }

        if (string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Password is required";
            return;
        }

        IsLoading = true;
        ErrorMessage = null;

        try
        {
            var success = await _authService.LoginAsync(Username, Password, RememberMe);

            if (success)
            {
                // Navigate to new-order after successful login
                await Shell.Current.GoToAsync($"//{Routes.NewOrder}", false);
            }
            else
            {
                ErrorMessage = "Invalid username or password.";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = "An error occurred. Please try again.";
            System.Diagnostics.Debug.WriteLine($"Login error: {ex.Message}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void ToggleRememberMe()
    {
        RememberMe = !RememberMe;
    }

    #endregion
}
