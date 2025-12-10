using WTF.MAUI.Services;
using WTF.MAUI.ViewModels;
using WTF.MAUI.Views;

namespace WTF.MAUI;

public partial class MainPage : ContentPage, IInitializablePage
{
    private readonly IAuthService _authService;
    private readonly ContainerViewModel _containerViewModel;
    int count = 0;

    public MainPage(IAuthService authService, ContainerViewModel containerViewModel)
    {
        _authService = authService;
        _containerViewModel = containerViewModel;
        
        InitializeComponent();
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        
        // Update container current page
        _containerViewModel.CurrentPage = "MainPage";
    }

    public void InitializePage()
    {
        // Call the same logic as OnAppearing
        _containerViewModel.CurrentPage = "MainPage";
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
