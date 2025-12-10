using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Maui.Controls;
using WTF.MAUI.Services;
using WTF.MAUI.Views;

namespace WTF.MAUI.ViewModels;

public partial class SidebarViewModel : ObservableObject
{
    #region Fields

    private readonly IAuthService _authService;
    private readonly IServiceProvider _serviceProvider;

    #endregion

    #region Constructor

    public SidebarViewModel(IAuthService authService, IServiceProvider serviceProvider)
    {
        _authService = authService;
        _serviceProvider = serviceProvider;
    }

    #endregion

    #region Observable Properties

    [ObservableProperty]
    private bool isSidebarExtended = true;

    [ObservableProperty]
    private string currentPage = "MainPage";

    [ObservableProperty]
    private View? currentPageContent;

    #endregion

    #region Computed Properties

    public double SidebarWidth => IsSidebarExtended ? 200 : 64;
    public string SidebarToggleIcon => IsSidebarExtended ? "\ueac3" : "\ueac9"; // Material icons: keyboard_double_arrow_left / keyboard_double_arrow_right

    #endregion

    #region Public Methods

    public void InitializeWithHomePage()
    {
        LoadPageContent<MainPage>();
    }

    public bool IsPageActive(string pageName) => CurrentPage == pageName;

    #endregion

    #region Commands

    [RelayCommand]
    private void ToggleSidebar()
    {
        IsSidebarExtended = !IsSidebarExtended;
        OnPropertyChanged(nameof(SidebarWidth));
        OnPropertyChanged(nameof(SidebarToggleIcon));
    }

    [RelayCommand]
    private void NavigateHome()
    {
        if (CurrentPage == "MainPage")
        {
            return;
        }

        CurrentPage = "MainPage";
        LoadPageContent<MainPage>();
    }

    [RelayCommand]
    private void NavigateOrders()
    {
        if (CurrentPage == "OrderPage")
        {
            return;
        }

        CurrentPage = "OrderPage";
        LoadPageContent<OrderPage>();
    }

    [RelayCommand]
    private async Task Logout()
    {
        _authService.Logout();

        await _authService.RequireLoginAsync();
    }

    #endregion

    #region Private Helper Methods

    private void LoadPageContent<T>() where T : ContentPage
    {
        try
        {
            var page = _serviceProvider.GetService(typeof(T)) as ContentPage;
            if (page == null)
            {
                return;
            }

            // Ensure the page's content is initialized by accessing it
            var content = page.Content;

            // Wait a moment for XAML to fully load
            Task.Run(async () =>
            {
                await Task.Delay(50); // Small delay to ensure XAML is parsed

                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    if (page.Content is SidebarLayout sidebarLayout)
                    {
                        // Get the PageContent property value
                        if (sidebarLayout.PageContent != null)
                        {
                            CurrentPageContent = sidebarLayout.PageContent;
                        }
                        else
                        {
                            // Fallback: try to get from the ContentPresenter
                            var presenter = sidebarLayout.FindByName<ContentPresenter>("MainContentPresenter");
                            if (presenter?.Content != null)
                            {
                                CurrentPageContent = presenter.Content;
                            }
                        }
                    }

                    // Call initialization logic if implemented
                    if (page is IInitializablePage initializable)
                    {
                        initializable.InitializePage();
                    }
                });
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error loading page content: {ex.Message}");
        }
    }

    #endregion
}
