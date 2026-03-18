using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace WTF.Api.Services;

public sealed class FcmPushClient : IFcmPushClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly HttpClient _httpClient;
    private readonly FcmAccessTokenProvider _tokenProvider;
    private readonly FcmOptions _options;
    private readonly ILogger<FcmPushClient> _logger;

    public FcmPushClient(
        HttpClient httpClient,
        FcmAccessTokenProvider tokenProvider,
        IOptions<FcmOptions> options,
        ILogger<FcmPushClient> logger)
    {
        _httpClient = httpClient;
        _tokenProvider = tokenProvider;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured => _tokenProvider.IsConfigured;

    public async Task<bool> SendAsync(
        string token,
        string title,
        string body,
        IReadOnlyDictionary<string, string>? data,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning("FCM push client is not configured.");
            return false;
        }

        var accessToken = await _tokenProvider.GetAccessTokenAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            _logger.LogWarning("FCM access token unavailable.");
            return false;
        }

        var projectId = _options.ProjectId!;
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://fcm.googleapis.com/v1/projects/{projectId}/messages:send");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var payload = new
        {
            message = new
            {
                token,
                data,
                android = new
                {
                    notification = new { title, body }
                },
                webpush = new
                {
                    notification = new
                    {
                        title,
                        body,
                        data
                    }
                }
            }
        };

        request.Content = JsonContent.Create(payload, options: JsonOptions);
        var response = await _httpClient.SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("FCM send succeeded for token {Token}.", token);
            return true;
        }

        var error = await response.Content.ReadAsStringAsync(cancellationToken);
        _logger.LogWarning(
            "FCM send failed for token {Token}. Status: {Status}. Response: {Response}",
            token,
            response.StatusCode,
            error);
        return false;
    }
}
