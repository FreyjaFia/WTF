using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using WTF.UI;
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

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(wtfSettings!.BaseUrl) });

await builder.Build().RunAsync();
