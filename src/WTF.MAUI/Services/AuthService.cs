using System.Net.Http.Json;
using WTF.Contracts.Auth.Login;

namespace WTF.MAUI.Services
{
    public interface IAuthService
    {
        Task<bool> LoginAsync(string username, string password);
        Task<bool> ValidateTokenAsync();
        void Logout();
    }

    public class AuthService(HttpClient httpClient, ITokenService tokenService) : IAuthService
    {
        public async Task<bool> LoginAsync(string username, string password)
        {
            var response = await httpClient.PostAsJsonAsync("/api/auth/login", new { username, password });

            if (response.IsSuccessStatusCode)
            {
                var token = await response.Content.ReadFromJsonAsync<LoginDto>();

                if (token?.AccessToken != null)
                {
                    await tokenService.SetAccessTokenAsync(token.AccessToken);
                    return true;
                }
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
                tokenService.RemoveAccessToken();
                return false;
            }
            catch
            {
                // If validation fails, clear the token
                tokenService.RemoveAccessToken();
                return false;
            }
        }

        public void Logout()
        {
            tokenService.RemoveAccessToken();
        }
    }
}