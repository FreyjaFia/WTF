using Blazored.LocalStorage;
using System.Net.Http.Json;
using WTF.Contracts.Auth.Login;

namespace WTF.UI.Features.Auth.Services;

public interface IAuthService
{
    Task<bool> LoginAsync(string username, string password);
    Task<bool> ValidateTokenAsync();
    Task LogoutAsync();
}

public class AuthService(HttpClient httpClient, ILocalStorageService localStorageService) : IAuthService
{
    public async Task<bool> LoginAsync(string username, string password)
    {
        var response = await httpClient.PostAsJsonAsync("/api/auth/login", new { username, password });

        if (response.IsSuccessStatusCode)
        {
            var token = await response.Content.ReadFromJsonAsync<LoginDto>();
            await localStorageService.SetItemAsync("accessToken", token?.AccessToken);

            return true;
        }

        return false;
    }

    public async Task<bool> ValidateTokenAsync()
    {
        try
        {
            var response = await httpClient.GetAsync("/api/auth/validate");

            if (response.IsSuccessStatusCode)
            {
                return true;
            }

            // Token is invalid, clear it
            await localStorageService.RemoveItemAsync("accessToken");
            return false;
        }
        catch
        {
            // If validation fails, clear the token
            await localStorageService.RemoveItemAsync("accessToken");
            return false;
        }
    }

    public async Task LogoutAsync()
    {
        await localStorageService.RemoveItemAsync("accessToken");
    }
}