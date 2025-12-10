using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WTF.MAUI.Services;
using WTF.MAUI.Views;

namespace WTF.MAUI.ViewModels;

public partial class ContainerViewModel : ObservableObject
{
    #region Fields

    private readonly IAuthService _authService;
    private readonly IServiceProvider _serviceProvider;

    #endregion

    #region Constructor

    public ContainerViewModel(IAuthService authService, IServiceProvider serviceProvider)
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
    public string SidebarToggleIcon => IsSidebarExtended ? "\ueac3" : "\ueac9";

    #endregion

    #region Public Methods

    public void InitializeWithHomePage()
    {
        LoadPageContent<MainPage>();
    }

    public bool IsPageActive(string pageName) => CurrentPage == pageName;

    public void NavigateToOrderForm(Guid? orderId = null)
    {
        CurrentPage = "OrderPage";
        LoadPageContentWithParameter<OrderFormPage>(orderId);
    }

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

            // Get the page content directly (no more SidebarLayout wrapper!)
            var content = page.Content;

            Task.Run(async () =>
            {
                await Task.Delay(50);

                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    CurrentPageContent = content;

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

    private void LoadPageContentWithParameter<T>(Guid? orderId) where T : ContentPage
    {
        try
        {
            var page = _serviceProvider.GetService(typeof(T)) as ContentPage;
            if (page == null)
            {
                return;
            }

            // Get the page content directly
            var content = page.Content;

            Task.Run(async () =>
            {
                await Task.Delay(50);

                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    CurrentPageContent = content;

                    // Initialize OrderFormPage with orderId
                    if (page is OrderFormPage orderFormPage)
                    {
                        var viewModel = orderFormPage.BindingContext as OrderFormViewModel;
                        if (viewModel != null)
                        {
                            await viewModel.InitializeAsync(orderId);
                        }
                    }
                });
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error loading page content with parameter: {ex.Message}");
        }
    }

    #endregion
}
