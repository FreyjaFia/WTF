using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Reflection;
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
                    fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
                });

            var assembly = Assembly.GetExecutingAssembly();
            using var stream = assembly.GetManifestResourceStream("WTF.MAUI.appsettings.json");

            var config = new ConfigurationBuilder()
                .AddJsonStream(stream!)
                .Build();

            builder.Configuration.AddConfiguration(config);

#if DEBUG
            builder.Logging.AddDebug();
#endif

            var wtfSettings = builder.Configuration
                .GetSection("WtfSettings")
                .Get<WtfSettings>();

            builder.Services.AddSingleton(wtfSettings!);

            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddScoped<ITokenService, TokenService>();

            builder.Services.AddHttpClient("Api", client => { client.BaseAddress = new Uri(wtfSettings!.BaseUrl); })
                .AddHttpMessageHandler<AuthTokenHandler>();

            builder.Services.AddScoped(sp => sp.GetRequiredService<IHttpClientFactory>().CreateClient("Api"));

            return builder.Build();
        }
    }
}
