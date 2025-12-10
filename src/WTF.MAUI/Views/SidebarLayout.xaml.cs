using WTF.MAUI.ViewModels;

namespace WTF.MAUI.Views;

public partial class SidebarLayout : ContentView
{
    public static readonly BindableProperty PageContentProperty =
        BindableProperty.Create(nameof(PageContent), typeof(View), typeof(SidebarLayout), propertyChanged: OnPageContentChanged);

    public View PageContent
    {
        get => (View)GetValue(PageContentProperty);
        set => SetValue(PageContentProperty, value);
    }

    private static void OnPageContentChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is SidebarLayout layout && newValue is View view)
        {
            layout.MainContentPresenter.Content = view;
        }
    }

    public SidebarLayout()
    {
        InitializeComponent();
    }
}
