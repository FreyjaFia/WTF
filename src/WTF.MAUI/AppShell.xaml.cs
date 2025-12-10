using WTF.MAUI.Views;

namespace WTF.MAUI;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();

        // Register detail routes here
        Routing.RegisterRoute("OrderFormPage", typeof(OrderFormPage));
    }
}
