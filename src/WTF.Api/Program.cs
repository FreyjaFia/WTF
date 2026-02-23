using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using System.Threading.RateLimiting;
using WTF.Api.Common.Auth;
using WTF.Api.Endpoints;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddDbContext<WTFDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("WtfDb")));

builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(Program).Assembly));

builder.Services.AddSignalR();

builder.Services.AddHttpContextAccessor();

builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddScoped<IUserRoleService, UserRoleService>();

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<IImageStorage, LocalImageStorage>();
}
else
{
    builder.Services.AddScoped<IImageStorage, AzureBlobImageStorage>();
}

var jwtSecretKey = builder.Configuration["Jwt:SecretKey"] ?? throw new InvalidOperationException("JWT SecretKey not configured");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? throw new InvalidOperationException("JWT Issuer not configured");
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? throw new InvalidOperationException("JWT Audience not configured");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecretKey)),
        ValidateIssuer = true,
        ValidIssuer = jwtIssuer,
        ValidateAudience = true,
        ValidAudience = jwtAudience,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.Zero
    };

    // Allow SignalR clients to send the JWT via query string
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];

            if (!string.IsNullOrEmpty(accessToken) &&
                context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
            {
                context.Token = accessToken;
            }

            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AppPolicies.ProductsRead, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
    .AddPolicy(AppPolicies.ManagementRead, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.AdminViewer))
    .AddPolicy(AppPolicies.ManagementWrite, policy =>
        policy.RequireRole(AppRoles.Admin))
    .AddPolicy(AppPolicies.OrdersRead, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
    .AddPolicy(AppPolicies.OrdersWrite, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.Cashier))
    .AddPolicy(AppPolicies.CustomersRead, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.AdminViewer, AppRoles.Cashier))
    .AddPolicy(AppPolicies.CustomersWrite, policy =>
        policy.RequireRole(AppRoles.Admin))
    .AddPolicy(AppPolicies.CustomersCreate, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.Cashier))
    .AddPolicy(AppPolicies.DashboardRead, policy =>
        policy.RequireRole(AppRoles.Admin, AppRoles.AdminViewer));

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowUI", policy =>
    {
        if (builder.Environment.IsDevelopment())
        {
            policy.SetIsOriginAllowed(_ => true)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
        else
        {
            policy.WithOrigins(
                    "https://localhost",
                    "http://localhost",
                    "capacitor://localhost")
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    });
});

builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("loyalty-policy", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "local",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromSeconds(10),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }));
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("AllowUI");
app.UseRateLimiter();

// Configure a stable static root across environments.
var staticRoot = !string.IsNullOrWhiteSpace(builder.Environment.WebRootPath)
    ? builder.Environment.WebRootPath!
    : Path.Combine(builder.Environment.ContentRootPath, "wwwroot");

if (!Directory.Exists(staticRoot))
{
    Directory.CreateDirectory(staticRoot);
}

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(staticRoot),
    RequestPath = ""
});

// Only use HTTPS redirection in production (not in development for mobile apps)
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapHub<DashboardHub>("/hubs/dashboard");

app.MapGet("/api", () => "Welcome to the WTF API!");
app.MapAuth()
    .MapLoyalty()
    .MapProducts()
    .MapOrders()
    .MapCustomers()
    .MapUsers()
    .MapDashboard()
    .MapSync()
    .MapPing();

// SPA fallback: serve index.html for non-API, non-file routes
app.MapFallbackToFile("index.html");

app.Run();
