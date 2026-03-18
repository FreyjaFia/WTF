using Google.Apis.Auth.OAuth2;
using Microsoft.Extensions.Options;

namespace WTF.Api.Services;

public sealed class FcmAccessTokenProvider
{
    private static readonly string[] Scopes = ["https://www.googleapis.com/auth/firebase.messaging"];

    private readonly FcmOptions _options;
    private readonly ILogger<FcmAccessTokenProvider> _logger;
    private GoogleCredential? _credential;
    private string? _accessToken;
    private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;

    public FcmAccessTokenProvider(
        IOptions<FcmOptions> options,
        ILogger<FcmAccessTokenProvider> logger)
    {
        _options = options.Value;
        _logger = logger;

        if (IsConfigured)
        {
            var source = !string.IsNullOrWhiteSpace(_options.ServiceAccountJsonPath)
                ? "path"
                : "inline";
            _logger.LogInformation(
                "FCM config loaded for project {ProjectId} using {Source} service account.",
                _options.ProjectId,
                source);
        }
        else
        {
            _logger.LogWarning("FCM config is incomplete. Push sends will be skipped.");
        }
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.ProjectId)
        && (!string.IsNullOrWhiteSpace(_options.ServiceAccountJson)
            || !string.IsNullOrWhiteSpace(_options.ServiceAccountJsonPath));

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

        _credential ??= BuildCredential();
        if (_credential is null)
        {
            _logger.LogWarning("FCM credential could not be created.");
            return null;
        }

        var token = await _credential
            .UnderlyingCredential
            .GetAccessTokenForRequestAsync(null, cancellationToken);

        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        _accessToken = token;
        _expiresAt = DateTimeOffset.UtcNow.AddMinutes(55);
        return token;
    }

    private GoogleCredential? BuildCredential()
    {
        if (!string.IsNullOrWhiteSpace(_options.ServiceAccountJson))
        {
            return GoogleCredential
                .FromJson(_options.ServiceAccountJson)
                .CreateScoped(Scopes);
        }

        if (!string.IsNullOrWhiteSpace(_options.ServiceAccountJsonPath))
        {
            if (!File.Exists(_options.ServiceAccountJsonPath))
            {
                _logger.LogWarning(
                    "FCM service account file not found at {Path}.",
                    _options.ServiceAccountJsonPath);
                return null;
            }

            return GoogleCredential
                .FromFile(_options.ServiceAccountJsonPath)
                .CreateScoped(Scopes);
        }

        return null;
    }
}
