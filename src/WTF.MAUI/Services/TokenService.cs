namespace WTF.MAUI.Services
{
    public interface ITokenService
    {
        Task<string?> GetAccessTokenAsync();
        Task SetAccessTokenAsync(string token, bool rememberMe);
        void RemoveAccessToken();
    }

    public class TokenService : ITokenService
    {
        private const string TokenKey = "accessToken";
        private string? _sessionToken; // In-memory storage for session-only tokens

        public async Task<string?> GetAccessTokenAsync()
        {
            try
            {
                // Check session token first (Remember Me = false)
                if (!string.IsNullOrEmpty(_sessionToken))
                {
                    return _sessionToken;
                }

                // Fall back to SecureStorage (Remember Me = true)
                var token = await SecureStorage.Default.GetAsync(TokenKey);
                if (!string.IsNullOrEmpty(token))
                {
                    return token;
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        public async Task SetAccessTokenAsync(string token, bool rememberMe)
        {
            // Clear both storages first to avoid duplication
            RemoveAccessToken();

            if (rememberMe)
            {
                // Store in SecureStorage (persists after app close)
                await SecureStorage.Default.SetAsync(TokenKey, token);
            }
            else
            {
                // Store in memory only (cleared when app closes)
                _sessionToken = token;
            }
        }

        public void RemoveAccessToken()
        {
            // Clear from both storages
            _sessionToken = null;
            SecureStorage.Default.Remove(TokenKey);
        }
    }
}
