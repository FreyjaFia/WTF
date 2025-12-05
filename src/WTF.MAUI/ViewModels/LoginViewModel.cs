using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.MAUI.Services;

namespace WTF.MAUI.ViewModels
{
    public partial class LoginViewModel(IAuthService authService) : ObservableObject
    {
        [ObservableProperty]
        private string _username;

        [ObservableProperty]
        private string _password;

        [ObservableProperty]
        private bool _isLoading;

        [ObservableProperty]
        private string? _errorMessage;

        [ObservableProperty]
        private bool _rememberMe;

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
                var success = await authService.LoginAsync(Username, Password);

                if (success)
                {
                    // Navigate to main page after successful login
                    await Shell.Current.GoToAsync("//OrderPage");
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

        public async Task CheckLoginStatusAsync()
        {
            try
            {
                var isLoggedIn = await authService.IsLoggedInAsync();

                if (isLoggedIn)
                {
                    // Already logged in, navigate to main page
                    await Shell.Current.GoToAsync("//OrderPage");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Check login status error: {ex.Message}");
            }
        }
    }
}
