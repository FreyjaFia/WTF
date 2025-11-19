using System.Net.Http.Json;
using Blazored.LocalStorage;
using WTF.Contracts.Auth.Login;

namespace WTF.UI.Features.Auth.Services;

public interface IAuthService
{
    Task<bool> LoginAsync(string username, string password);
}

public class AuthService(HttpClient httpClient, ILocalStorageService localStorageService) : IAuthService
{
    public async Task<bool> LoginAsync(string username, string password)
    {
        var response = await httpClient.PostAsJsonAsync("/api/auth/login", new { username, password });

        if (response.IsSuccessStatusCode)
        {
            var token = await response.Content.ReadFromJsonAsync<TokenDto>();
            await localStorageService.SetItemAsync("accessToken", token?.AccessToken);

            return true;
        }

        return false;
    }
}