using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace WTF.Api.Services;

public sealed class HuaweiAccessTokenProvider
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private const string DefaultOAuthEndpoint = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";

    private readonly HuaweiPushOptions _options;
    private readonly ILogger<HuaweiAccessTokenProvider> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private string? _accessToken;
    private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;

    public HuaweiAccessTokenProvider(
        IOptions<HuaweiPushOptions> options,
        ILogger<HuaweiAccessTokenProvider> logger,
        IHttpClientFactory httpClientFactory)
    {
        _options = options.Value;
        _logger = logger;
        _httpClientFactory = httpClientFactory;

        if (IsConfigured)
        {
            _logger.LogInformation("Huawei Push config loaded for app {AppId}.", _options.AppId);
        }
        else
        {
            _logger.LogWarning("Huawei Push config is incomplete. Push sends will be skipped.");
        }
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.AppId)
        && !string.IsNullOrWhiteSpace(_options.AppSecret);

    public async Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(_accessToken) && _expiresAt > DateTimeOffset.UtcNow.AddMinutes(5))
        {
            return _accessToken;
        }

        var endpoint = string.IsNullOrWhiteSpace(_options.OAuthEndpoint)
            ? DefaultOAuthEndpoint
            : _options.OAuthEndpoint!;

        var payload = new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["client_id"] = _options.AppId!,
            ["client_secret"] = _options.AppSecret!
        };

        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new FormUrlEncodedContent(payload)
        };

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning(
                "Huawei OAuth token request failed. Status: {Status}. Response: {Response}",
                response.StatusCode,
                error);
            return null;
        }

        var tokenResponse = await response.Content
            .ReadFromJsonAsync<HuaweiTokenResponse>(JsonOptions, cancellationToken);

        if (string.IsNullOrWhiteSpace(tokenResponse?.AccessToken))
        {
            _logger.LogWarning("Huawei OAuth token response missing access token.");
            return null;
        }

        _accessToken = tokenResponse.AccessToken;
        var expiresInSeconds = tokenResponse.ExpiresIn > 0 ? tokenResponse.ExpiresIn : 3600;
        _expiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresInSeconds - 300);
        return _accessToken;
    }

    private sealed class HuaweiTokenResponse
    {
        [System.Text.Json.Serialization.JsonPropertyName("access_token")]
        public string? AccessToken { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }
    }
}
