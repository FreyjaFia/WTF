namespace WTF.MAUI.Services
{
    public interface ITokenService
    {
        Task<string?> GetAccessTokenAsync();
        Task SetAccessTokenAsync(string token);
        void RemoveAccessToken();
    }

    public class TokenService : ITokenService
    {
        private const string TokenKey = "accessToken";

        public async Task<string?> GetAccessTokenAsync()
        {
            try
            {
                return await SecureStorage.Default.GetAsync(TokenKey);
            }
            catch
            {
                return null;
            }
        }

        public async Task SetAccessTokenAsync(string token)
        {
            await SecureStorage.Default.SetAsync(TokenKey, token);
        }

        public void RemoveAccessToken()
        {
            SecureStorage.Default.Remove(TokenKey);
        }
    }
}
