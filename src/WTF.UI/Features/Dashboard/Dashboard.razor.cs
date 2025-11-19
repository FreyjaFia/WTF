using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;

namespace WTF.UI.Features.Dashboard;

public partial class Dashboard : ComponentBase
{
    [Inject] private ILocalStorageService LocalStorageService { get; set; } = default!;

    protected override async Task OnInitializedAsync()
    {
        var token = await LocalStorageService.GetItemAsStringAsync("accessToken");
        Console.WriteLine($"Token from LocalStorage: {token}");

        await base.OnInitializedAsync();
    }
}