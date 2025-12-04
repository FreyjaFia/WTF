using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using WTF.Contracts.Auth.Login;
using WTF.UI.Features.Auth.Services;

namespace WTF.UI.Features.Auth.Login;

public partial class Login : ComponentBase
{
    [Inject] private IAuthService AuthService { get; set; } = default!;
    [Inject] private NavigationManager NavManager { get; set; } = default!;
    [Inject] private ILocalStorageService LocalStorageService { get; set; } = default!;

    protected LoginRequestDto? LoginRequestDto = new();
    protected bool IsLoading { get; set; }
    protected string ErrorMessage { get; set; } = string.Empty;

    protected override async Task OnInitializedAsync()
    {
        // Check if user already has a valid token
        var token = await LocalStorageService.GetItemAsStringAsync("accessToken");
        
        if (!string.IsNullOrWhiteSpace(token))
        {
            // Validate the existing token
            var isValid = await AuthService.ValidateTokenAsync();
            
            if (isValid)
            {
                Console.WriteLine("User already logged in - redirecting to dashboard");
                NavManager.NavigateTo("/dashboard");
                return;
            }
        }

        await base.OnInitializedAsync();
    }

    private async Task HandleLogin(EditContext context)
    {
        if (!context.Validate())
        {
            return;
        }

        IsLoading = true;
        ErrorMessage = string.Empty;
        StateHasChanged();

        try
        {
            var success = await AuthService.LoginAsync(LoginRequestDto!.Username, LoginRequestDto.Password);
            
            if (success)
            {
                NavManager.NavigateTo("/dashboard");
            }
            else
            {
                ErrorMessage = "Invalid username or password. Please try again.";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = "An error occurred while logging in. Please try again later.";
            Console.WriteLine($"Login error: {ex.Message}");
        }
        finally
        {
            IsLoading = false;
            StateHasChanged();
        }
    }
}
