using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;
using WTF.UI.Features.Test.Services;

namespace WTF.UI.Features.Dashboard;

public partial class Dashboard : ComponentBase
{
    [Inject] private ILocalStorageService LocalStorageService { get; set; } = default!;
    [Inject] private ITestService TestService { get; set; } = default!;
    [Inject] private NavigationManager NavManager { get; set; } = default!;

    protected string? AccessToken { get; set; }
    protected TestResponse? ProtectedTestResult { get; set; }
    protected TestResponse? PublicTestResult { get; set; }
    protected string? ErrorMessage { get; set; }
    protected bool IsLoading { get; set; }

    protected override async Task OnInitializedAsync()
    {
        AccessToken = await LocalStorageService.GetItemAsStringAsync("accessToken");
        Console.WriteLine($"Token from LocalStorage: {AccessToken}");

        // Auto-redirect to login if no token found
        if (string.IsNullOrWhiteSpace(AccessToken))
        {
            NavManager.NavigateTo("/login");
            return;
        }

        await base.OnInitializedAsync();
    }

    protected async Task TestProtectedEndpoint()
    {
        IsLoading = true;
        ErrorMessage = null;
        ProtectedTestResult = null;
        StateHasChanged();

        try
        {
            ProtectedTestResult = await TestService.TestProtectedEndpointAsync();
            if (ProtectedTestResult == null)
            {
                ErrorMessage = "Failed to call protected endpoint. Check authentication.";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Error: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
            StateHasChanged();
        }
    }

    protected async Task TestPublicEndpoint()
    {
        IsLoading = true;
        ErrorMessage = null;
        PublicTestResult = null;
        StateHasChanged();

        try
        {
            PublicTestResult = await TestService.TestPublicEndpointAsync();
            if (PublicTestResult == null)
            {
                ErrorMessage = "Failed to call public endpoint.";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Error: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
            StateHasChanged();
        }
    }
}