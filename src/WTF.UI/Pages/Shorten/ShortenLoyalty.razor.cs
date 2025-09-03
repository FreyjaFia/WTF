using Microsoft.AspNetCore.Components;
using System.Net.Http.Json;
using WTF.Contracts;

namespace WTF.UI.Pages.Shorten
{
    public partial class ShortenLoyalty : ComponentBase
    {
        [Parameter] public string? Token { get; set; }
        [Inject] private HttpClient Http { get; set; } = default!;
        [Inject] private NavigationManager NavManager { get; set; } = default!;

        protected LoyaltyPointsDto? LoyaltyPoints;
        protected RedirectToLoyaltyDto? RedirectToLoyalty;
        protected int RemainingPoints => 9 - LoyaltyPoints?.Points ?? 0;
        protected bool IsLoading = true;

        private readonly List<string> cardImages =
            [
                "assets/images/cards/0.jpg",
                "assets/images/cards/1.jpg",
                "assets/images/cards/2.jpg",
                "assets/images/cards/3.jpg",
                "assets/images/cards/4.jpg",
                "assets/images/cards/5.jpg",
                "assets/images/cards/6.jpg",
                "assets/images/cards/7.jpg",
                "assets/images/cards/8.jpg",
                "assets/images/cards/9.jpg",
            ];

        protected override async Task OnParametersSetAsync()
        {
            if (string.IsNullOrWhiteSpace(Token))
            {
                NavManager.NavigateTo("/");
                return;
            }

            try
            {
                RedirectToLoyalty = await Http.GetFromJsonAsync<RedirectToLoyaltyDto>(
                    $"api/loyalty/redirect/{Token}");
            }
            catch
            {
                RedirectToLoyalty = null;
                NavManager.NavigateTo("/");
                return;
            }

            if (RedirectToLoyalty == null)
            {
                NavManager.NavigateTo("/");
                return;
            }

            IsLoading = true;
            StateHasChanged();

            try
            {
                LoyaltyPoints = await Http.GetFromJsonAsync<LoyaltyPointsDto>(
                    $"api/loyalty/{RedirectToLoyalty.CustomerId}");
            }
            catch
            {
                LoyaltyPoints = null;
                NavManager.NavigateTo("/");
            }
            finally
            {
                IsLoading = false;
            }
        }

        protected string GetCardImage()
        {
            if (LoyaltyPoints == null || LoyaltyPoints.Points < 0 || LoyaltyPoints.Points > 9)
            {
                return "assets/images/cards/0.jpg";
            }

            return cardImages[LoyaltyPoints.Points];
        }
    }
}
