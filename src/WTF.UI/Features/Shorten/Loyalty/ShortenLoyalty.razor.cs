using Microsoft.AspNetCore.Components;
using WTF.Contracts.Loyalty.ShortenLoyalty;
using WTF.UI.Features.Shorten.Services;

namespace WTF.UI.Features.Shorten.Loyalty;

public partial class ShortenLoyalty : ComponentBase
{
    [Parameter] public string? Token { get; set; }
    [Inject] private IShortenService ShortenService { get; set; } = default!;
    [Inject] private NavigationManager NavManager { get; set; } = default!;

    protected ShortenLoyaltyDto? ShortenLoyaltyDto;
    protected int FreeCoffee => (ShortenLoyaltyDto?.Points ?? 0) / 9;
    protected int RemainingPoints => (ShortenLoyaltyDto?.Points ?? 0) % 9;
    protected int NextCoffee => 9 - RemainingPoints;
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
            NavManager.NavigateTo("/redirect");
            return;
        }

        IsLoading = true;
        StateHasChanged();

        try
        {
            ShortenLoyaltyDto = await ShortenService.GetLoyaltyByTokenAsync(Token);

            if (ShortenLoyaltyDto == null)
            {
                NavManager.NavigateTo("/redirect");
            }
        }
        catch
        {
            NavManager.NavigateTo("/redirect");
        }
        finally
        {
            IsLoading = false;
        }
    }

    protected string GetCardImage()
    {
        return cardImages[RemainingPoints];
    }
}
