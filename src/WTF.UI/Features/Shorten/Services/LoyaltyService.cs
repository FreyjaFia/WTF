using System.Net.Http.Json;
using WTF.Contracts.Loyalty.GenerateShortLink;
using WTF.Contracts.Loyalty.GetLoyaltyPoints;
using WTF.Contracts.Loyalty.RedirectToLoyalty;
using WTF.Contracts.Loyalty.ShortenLoyalty;

namespace WTF.UI.Features.Shorten.Services;

public interface ILoyaltyService
{
    Task<ShortenLoyaltyDto?> GetLoyaltyByTokenAsync(string token);
    Task<GetLoyaltyPointsDto?> GetLoyaltyPointsAsync(Guid customerId);
    Task<GenerateShortLinkDto?> GenerateShortLinkAsync(Guid customerId);
}

public class LoyaltyService(HttpClient httpClient) : ILoyaltyService
{
    public async Task<ShortenLoyaltyDto?> GetLoyaltyByTokenAsync(string token)
    {
        try
        {
            var redirectResponse = await httpClient.GetFromJsonAsync<RedirectToLoyaltyDto>($"api/loyalty/redirect/{token}");

            if (redirectResponse?.CustomerId == null)
            {
                return null;
            }

            var loyaltyData = await httpClient.GetFromJsonAsync<ShortenLoyaltyDto>($"api/loyalty/{redirectResponse.CustomerId}");
            return loyaltyData;
        }
        catch
        {
            return null;
        }
    }

    public async Task<GetLoyaltyPointsDto?> GetLoyaltyPointsAsync(Guid customerId)
    {
        try
        {
            var response = await httpClient.GetFromJsonAsync<GetLoyaltyPointsDto>($"api/loyalty/{customerId}");
            return response;
        }
        catch
        {
            return null;
        }
    }

    public async Task<GenerateShortLinkDto?> GenerateShortLinkAsync(Guid customerId)
    {
        try
        {
            var response = await httpClient.PostAsync($"api/loyalty/generate/{customerId}", null);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadFromJsonAsync<GenerateShortLinkDto>();
            }

            return null;
        }
        catch
        {
            return null;
        }
    }
}
