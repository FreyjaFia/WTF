using Microsoft.Extensions.DependencyInjection;

namespace WTF.MAUI;

public partial class App : Application
{
    public App(IServiceProvider serviceProvider)
    {
        InitializeComponent();
        ServiceProvider = serviceProvider;
    }

    public IServiceProvider ServiceProvider { get; }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        return new Window(ServiceProvider.GetRequiredService<AppShell>());
    }
}