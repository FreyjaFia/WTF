using Microsoft.AspNetCore.Components;

namespace WTF.UI.Pages
{
    public partial class Home : ComponentBase
    {
        [Inject] private NavigationManager NavManager { get; set; } = default!;
        protected int Countdown => _countdown;

        private int _countdown = 5;
        private Timer? _timer;

        protected override void OnInitialized()
        {
            _timer = new Timer(async _ =>
            {
                if (_countdown > 1)
                {
                    _countdown--;
                    await InvokeAsync(StateHasChanged);
                }
                else
                {
                    _timer?.Dispose();
                    await InvokeAsync(() =>
                        NavManager.NavigateTo("https://www.facebook.com/waketastefocuscoffeetogo", forceLoad: true));
                }
            }, null, 1000, 1000);
        }

        public void Dispose() => _timer?.Dispose();
    }
}
