using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Reflection;
using WTF.MAUI.Converters;
using WTF.MAUI.Infrastructure.Handlers;
using WTF.MAUI.Services;
using WTF.MAUI.Settings;
using WTF.MAUI.ViewModels;
using WTF.MAUI.Views;

namespace WTF.MAUI;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
                fonts.AddFont("MaterialSymbolsOutlined-Regular.ttf", "MaterialIconsOutlined");
            });

#if DEBUG
        builder.Logging.AddDebug();
#endif

        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream("WTF.MAUI.appsettings.json");

        if (stream != null)
        {
            builder.Configuration.AddJsonStream(stream);
        }

        var wtfSettings = builder.Configuration
            .GetSection("WtfSettings")
            .Get<WtfSettings>();

        builder.Services.AddSingleton(wtfSettings!);

        // Initialize converters with settings
        ProductImageUrlConverter.Initialize(wtfSettings!);

        // Register Services
        builder.Services.AddSingleton<ITokenService, TokenService>();
        builder.Services.AddSingleton<IAuthService, AuthService>();
        builder.Services.AddScoped<IOrderService, OrderService>();
        builder.Services.AddScoped<IProductService, ProductService>();

        // Register ViewModels
        builder.Services.AddTransient<LoginViewModel>();
        builder.Services.AddTransient<OrderViewModel>();
        builder.Services.AddTransient<OrderFormViewModel>();

        // Register Pages
        builder.Services.AddSingleton<AppShell>();
        builder.Services.AddTransient<LoadingPage>();
        builder.Services.AddTransient<LoginPage>();
        builder.Services.AddTransient<OrderPage>();
        builder.Services.AddTransient<OrderFormPage>();

        // Register HTTP Client with Auth Handler
        builder.Services.AddTransient<AuthTokenHandler>();

        builder.Services.AddHttpClient("Api", client =>
        {
            client.BaseAddress = new Uri(wtfSettings!.BaseUrl);
        })
        .AddHttpMessageHandler<AuthTokenHandler>();

        builder.Services.AddScoped(sp => sp.GetRequiredService<IHttpClientFactory>().CreateClient("Api"));

        return builder.Build();
    }
}
