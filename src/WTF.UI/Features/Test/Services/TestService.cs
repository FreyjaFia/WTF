using System.Net.Http.Json;

namespace WTF.UI.Features.Test.Services;

public interface ITestService
{
    Task<TestResponse?> TestProtectedEndpointAsync();
    Task<TestResponse?> TestPublicEndpointAsync();
}

public class TestService(HttpClient httpClient) : ITestService
{
    public async Task<TestResponse?> TestProtectedEndpointAsync()
    {
        try
        {
            var response = await httpClient.GetFromJsonAsync<TestResponse>("api/test/protected");
            return response;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Protected endpoint error: {ex.Message}");
            return null;
        }
    }

    public async Task<TestResponse?> TestPublicEndpointAsync()
    {
        try
        {
            var response = await httpClient.GetFromJsonAsync<TestResponse>("api/test/public");
            return response;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Public endpoint error: {ex.Message}");
            return null;
        }
    }
}

public record TestResponse(string Message, DateTime Timestamp);
