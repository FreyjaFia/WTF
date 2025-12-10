using WTF.MAUI.Views;

namespace WTF.MAUI;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();

        // OrderFormPage is now loaded via ContainerViewModel - no Shell routing needed
    }
}
