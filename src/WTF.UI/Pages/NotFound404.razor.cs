using Microsoft.AspNetCore.Components;

namespace WTF.UI.Pages
{
    public partial class NotFound404 : ComponentBase
    {
        [Inject] private NavigationManager NavManager { get; set; } = default!;

        protected override void OnInitialized()
        {
            NavManager.NavigateTo("/");
        }
    }
}
