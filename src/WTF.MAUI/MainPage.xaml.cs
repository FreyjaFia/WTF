using WTF.MAUI.Services;
using WTF.MAUI.ViewModels;
using WTF.MAUI.Views;

namespace WTF.MAUI;

public partial class MainPage : ContentPage, IInitializablePage
{
    private readonly IAuthService _authService;
    private readonly SidebarViewModel _sidebarViewModel;
    int count = 0;

    public MainPage(IAuthService authService, SidebarViewModel sidebarViewModel)
    {
        _authService = authService;
        _sidebarViewModel = sidebarViewModel;
        
        InitializeComponent();
        
        // Set sidebar binding context
        if (Content is SidebarLayout sidebar)
        {
            sidebar.BindingContext = _sidebarViewModel;
        }
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        
        // Update sidebar current page
        _sidebarViewModel.CurrentPage = "MainPage";
    }

    public void InitializePage()
    {
        // Call the same logic as OnAppearing
        _sidebarViewModel.CurrentPage = "MainPage";
    }

    private void OnCounterClicked(object sender, EventArgs e)
    {
        count++;

        if (count == 1)
        {
            CounterBtn.Text = $"Clicked {count} time";
        }
        else
        {
            CounterBtn.Text = $"Clicked {count} times";
        }

        SemanticScreenReader.Announce(CounterBtn.Text);
    }

    private async void OnLogoutClicked(object sender, EventArgs e)
    {
        _authService.Logout();

        await _authService.RequireLoginAsync();
    }
}
