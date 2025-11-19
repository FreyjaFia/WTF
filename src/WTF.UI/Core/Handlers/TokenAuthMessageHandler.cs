using Blazored.LocalStorage;
using System.Net.Http.Headers;

namespace WTF.UI.Core.Handlers;

public class TokenAuthMessageHandler(ILocalStorageService localStorageService) : DelegatingHandler
{
    private readonly ILocalStorageService _localStorageService = localStorageService;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var token = await _localStorageService.GetItemAsync<string>("accessToken", cancellationToken);

        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await base.SendAsync(request, cancellationToken);
    }
}