using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using WTF.UI;
using WTF.UI.Core.Handlers;
using WTF.UI.Features.Auth.Services;
using WTF.UI.Features.Shorten.Services;
using WTF.UI.Features.Test.Services;
using WTF.UI.Settings;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Configuration
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
    .AddJsonFile($"appsettings.{builder.HostEnvironment.Environment}.json", optional: true, reloadOnChange: true);

var wtfSettings = builder.Configuration
    .GetSection("WtfSettings")
    .Get<WtfSettings>();

builder.Services.AddSingleton(wtfSettings!);

builder.Services.AddBlazoredLocalStorage();
builder.Services.AddScoped<TokenAuthMessageHandler>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IShortenService, ShortenService>();
builder.Services.AddScoped<ITestService, TestService>();

builder.Services.AddHttpClient("Api", client => { client.BaseAddress = new Uri(wtfSettings!.BaseUrl); })
    .AddHttpMessageHandler<TokenAuthMessageHandler>();

builder.Services.AddScoped(sp => sp.GetRequiredService<IHttpClientFactory>().CreateClient("Api"));

await builder.Build().RunAsync();