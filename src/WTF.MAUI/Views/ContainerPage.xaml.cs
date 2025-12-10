using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class ContainerPage : ContentPage
{
    private readonly SidebarViewModel _sidebarViewModel;

    public ContainerPage(SidebarViewModel sidebarViewModel)
    {
        InitializeComponent();
        _sidebarViewModel = sidebarViewModel;
        
        BindingContext = _sidebarViewModel;
        
        // Initialize with home page
        _sidebarViewModel.InitializeWithHomePage();
        
        // Subscribe to page changes
        _sidebarViewModel.PropertyChanged += OnSidebarViewModelPropertyChanged;
    }

    private void OnSidebarViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SidebarViewModel.CurrentPageContent) && _sidebarViewModel.CurrentPageContent != null)
        {
            // Swap the content instantly without any animation
            MainContentPresenter.Content = _sidebarViewModel.CurrentPageContent;
        }
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        _sidebarViewModel.PropertyChanged -= OnSidebarViewModelPropertyChanged;
    }
}
