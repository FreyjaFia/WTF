namespace WTF.Api.Services;

public interface IFcmPushClient
{
    bool IsConfigured { get; }

    Task<bool> SendAsync(
        string token,
        string title,
        string body,
        IReadOnlyDictionary<string, string>? data,
        CancellationToken cancellationToken);
}
