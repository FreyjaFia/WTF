using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class ContainerPage : ContentPage
{
    private readonly ContainerViewModel _containerViewModel;

    public ContainerPage(ContainerViewModel containerViewModel)
    {
        InitializeComponent();
        _containerViewModel = containerViewModel;
        
        BindingContext = _containerViewModel;
        
        // Initialize with home page
        _containerViewModel.InitializeWithHomePage();
        
        // Subscribe to page changes
        _containerViewModel.PropertyChanged += OnContainerViewModelPropertyChanged;
    }

    private void OnContainerViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ContainerViewModel.CurrentPageContent) && _containerViewModel.CurrentPageContent != null)
        {
            // Swap the content instantly without any animation
            MainContentPresenter.Content = _containerViewModel.CurrentPageContent;
        }
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        _containerViewModel.PropertyChanged -= OnContainerViewModelPropertyChanged;
    }
}
