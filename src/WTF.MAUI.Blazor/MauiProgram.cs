using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using WTF.MAUI.Infrastructure.Handlers;
using WTF.MAUI.Services;
using WTF.MAUI.Settings;

namespace WTF.MAUI
{
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
                });

            builder.Services.AddMauiBlazorWebView();

#if DEBUG
            builder.Services.AddBlazorWebViewDeveloperTools();
            builder.Logging.AddDebug();
#endif

            var assembly = typeof(MauiProgram).Assembly;
            using var stream = assembly.GetManifestResourceStream("WTF.MAUI.appsettings.json");
            if (stream != null)
            {
                builder.Configuration.AddJsonStream(stream);
            }

#if !DEBUG
            var envStream = assembly.GetManifestResourceStream($"WTF.MAUI.appsettings.{builder.Environment.EnvironmentName}.json");
            if (envStream != null)
            {
                builder.Configuration.AddJsonStream(envStream);
            }
#endif

            var wtfSettings = builder.Configuration
                .GetSection("WtfSettings")
                .Get<WtfSettings>();

            builder.Services.AddSingleton(wtfSettings!);

            builder.Services.AddTransient<AuthTokenHandler>();

            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddScoped<ITokenService, TokenService>();

            builder.Services.AddHttpClient("Api", client => { client.BaseAddress = new Uri(wtfSettings!.BaseUrl); })
                .AddHttpMessageHandler<AuthTokenHandler>();

            builder.Services.AddScoped(sp => sp.GetRequiredService<IHttpClientFactory>().CreateClient("Api"));

            return builder.Build();
        }
    }
}
