using Microsoft.AspNetCore.Components;
using WTF.MAUI.Services;

namespace WTF.MAUI.Pages
{
    public partial class Home : ComponentBase
    {
        [Inject] private IAuthService AuthService { get; set; } = default!;

        override protected async Task OnInitializedAsync()
        {
            await AuthService.RequireLoginAsync();
        }
    }
}
