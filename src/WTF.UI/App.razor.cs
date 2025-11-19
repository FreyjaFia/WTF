using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;
using WTF.UI.Features.Auth.Services;

namespace WTF.UI;

public partial class App : ComponentBase
{
    [Inject] private IAuthService AuthService { get; set; } = default!;
    [Inject] private NavigationManager NavManager { get; set; } = default!;
    [Inject] private ILocalStorageService LocalStorageService { get; set; } = default!;

    protected override async Task OnInitializedAsync()
    {
        // Check if token exists in local storage
        var token = await LocalStorageService.GetItemAsStringAsync("accessToken");
        
        if (string.IsNullOrWhiteSpace(token))
        {
            Console.WriteLine("No token found - skipping validation");
            await base.OnInitializedAsync();
            return;
        }

        // Validate token on app load
        var isValid = await AuthService.ValidateTokenAsync();
        
        if (!isValid)
        {
            Console.WriteLine("Token validation failed - redirecting to login");
            
            // Auto logout and redirect to login (without forceLoad to preserve routing)
            await AuthService.LogoutAsync();
            NavManager.NavigateTo("/login");
        }
        else
        {
            Console.WriteLine("Token is valid");
        }

        await base.OnInitializedAsync();
    }
}
