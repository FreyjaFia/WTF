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

    public void NavigateToOrderFormPage(Guid? orderId = null)
    {
        CurrentPage = "OrderPage";
        LoadPageContent<OrderFormPage>(orderId);
    }

    public void NavigateToOrdersPage()
    {
        CurrentPage = "OrderPage";
        LoadPageContent<OrderPage>();
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

    private void LoadPageContent<T>(Guid? parameter = null) where T : ContentPage
    {
        try
        {
            // Create a new page instance instead of reusing an existing one to avoid moving the
            // same VisualElement between parents which can produce unexpected visual artifacts.
            var page = ActivatorUtilities.CreateInstance(_serviceProvider, typeof(T)) as ContentPage;
            if (page == null)
            {
                return;
            }

            // Get the page content directly
            var content = page.Content;

            // Set content immediately on UI thread
            CurrentPageContent = content;

            // Initialize page asynchronously (fire-and-forget is safe here)
            _ = InitializePageAsync(page, parameter);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error loading page content: {ex.Message}");
        }
    }

    private async Task InitializePageAsync(ContentPage page, Guid? parameter)
    {
        try
        {
            // Small delay to let UI settle and render the page first
            await Task.Delay(50);

            // Initialize ViewModels on main thread
            // HttpClient calls will naturally run on background threads
            if (page is OrderFormPage orderFormPage)
            {
                // OrderFormPage: Initialize with parameter (null for new order, Guid for edit)
                var viewModel = orderFormPage.BindingContext as OrderFormViewModel;
                if (viewModel != null)
                {
                    await viewModel.InitializeAsync(parameter);
                }
            }
            else if (page is OrderPage orderPage)
            {
                // OrderPage: Initialize without parameters
                var viewModel = orderPage.BindingContext as OrderViewModel;
                if (viewModel != null)
                {
                    await viewModel.InitializeAsync();
                }
            }
            else if (page is MainPage mainPage)
            {
                // MainPage: Just update current page
                CurrentPage = "MainPage";
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error initializing page: {ex.Message}");
        }
    }

    #endregion
}
