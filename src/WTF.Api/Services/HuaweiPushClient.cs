using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace WTF.Api.Services;

public interface IHuaweiPushClient
{
    bool IsConfigured { get; }

    Task<bool> SendAsync(
        string token,
        string title,
        string body,
        IReadOnlyDictionary<string, string>? data,
        CancellationToken cancellationToken);
}

public sealed class HuaweiPushClient : IHuaweiPushClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private const string DefaultPushEndpoint = "https://push-api.cloud.huawei.com";

    private readonly HttpClient _httpClient;
    private readonly HuaweiAccessTokenProvider _tokenProvider;
    private readonly HuaweiPushOptions _options;
    private readonly ILogger<HuaweiPushClient> _logger;

    public HuaweiPushClient(
        HttpClient httpClient,
        HuaweiAccessTokenProvider tokenProvider,
        IOptions<HuaweiPushOptions> options,
        ILogger<HuaweiPushClient> logger)
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
            _logger.LogWarning("Huawei Push client is not configured.");
            return false;
        }

        var accessToken = await _tokenProvider.GetAccessTokenAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            _logger.LogWarning("Huawei access token unavailable.");
            return false;
        }

        var appId = _options.AppId!;
        var baseEndpoint = string.IsNullOrWhiteSpace(_options.PushEndpoint)
            ? DefaultPushEndpoint
            : _options.PushEndpoint!.TrimEnd('/');
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{baseEndpoint}/v1/{appId}/messages:send");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var payload = new
        {
            message = new
            {
                notification = new { title, body },
                data = data is null ? null : JsonSerializer.Serialize(data, JsonOptions),
                android = new
                {
                    notification = new { title, body },
                    urgency = "HIGH"
                },
                token = new[] { token }
            }
        };

        request.Content = JsonContent.Create(payload, options: JsonOptions);
        var response = await _httpClient.SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("Huawei push send succeeded for token {Token}.", token);
            return true;
        }

        var error = await response.Content.ReadAsStringAsync(cancellationToken);
        _logger.LogWarning(
            "Huawei push send failed for token {Token}. Status: {Status}. Response: {Response}",
            token,
            response.StatusCode,
            error);
        return false;
    }
}
