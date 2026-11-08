using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using System.Text;
using System.Threading.RateLimiting;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Tenancy;
using WTF.Api.Common.Validation;
using WTF.Api.Endpoints;
using WTF.Api.Features.Conversations;
using WTF.Api.Features.Images;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Notifications;
using WTF.Api.Features.Reports;
using WTF.Api.Features.Subscriptions;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

var builder = WebApplication.CreateBuilder(args);

var logRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "private", "logs"));
Directory.CreateDirectory(logRoot);

Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.File(
        Path.Combine(logRoot, "wtf-api-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 7)
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.Configure<TenancyOptions>(builder.Configuration.GetSection(TenancyOptions.SectionName));
builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();

builder.Services.AddDbContext<WTFDbContext>(options =>
    options
        .UseSqlServer(builder.Configuration.GetConnectionString("WtfDb"))
        .ConfigureWarnings(w => w.Ignore(CoreEventId.PossibleIncorrectRequiredNavigationWithQueryFilterInteractionWarning)));

builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssembly(typeof(Program).Assembly);
    cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
});

builder.Services.AddSignalR();

builder.Services.AddHttpContextAccessor();
builder.Services.Configure<MonthlyReportWorkbookSchedulerOptions>(
    builder.Configuration.GetSection(MonthlyReportWorkbookSchedulerOptions.SectionName));
builder.Services.Configure<FcmOptions>(
    builder.Configuration.GetSection(FcmOptions.SectionName));
builder.Services.Configure<HuaweiPushOptions>(
    builder.Configuration.GetSection(HuaweiPushOptions.SectionName));

// One clock for code that must be testable around time (for example an ordering link expiring mid-request).
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<TenantStatusCache>();
builder.Services.AddSingleton<TenancyGate>();
builder.Services.AddScoped<IPlatformAuditService, PlatformAuditService>();
builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddScoped<IUserRoleService, UserRoleService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<IOrderStockService, OrderStockService>();
builder.Services.AddScoped<IStockAlertService, StockAlertService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddSingleton<FcmAccessTokenProvider>();
builder.Services.AddHttpClient<IFcmPushClient, FcmPushClient>();
builder.Services.AddSingleton<HuaweiAccessTokenProvider>();
builder.Services.AddHttpClient<IHuaweiPushClient, HuaweiPushClient>();
builder.Services.AddScoped<IPushNotificationService, PushNotificationService>();
builder.Services.AddScoped<IConversationNotifier, ConversationNotifier>();
builder.Services.Configure<ChatImageOptions>(
    builder.Configuration.GetSection(ChatImageOptions.SectionName));
builder.Services.AddScoped<IChatImageService, ChatImageService>();
builder.Services.AddScoped<IMonthlyReportWorkbookService, MonthlyReportWorkbookService>();
builder.Services.AddHostedService<MonthlyReportWorkbookScheduler>();
builder.Services.Configure<StaleImageCleanupOptions>(
    builder.Configuration.GetSection(StaleImageCleanupOptions.SectionName));
builder.Services.AddScoped<IStaleImageCleanupService, StaleImageCleanupService>();
builder.Services.AddHostedService<StaleImageCleanupScheduler>();
builder.Services.Configure<ChatRetentionOptions>(
    builder.Configuration.GetSection(ChatRetentionOptions.SectionName));
builder.Services.AddScoped<IChatMessageExpiryService, ChatMessageExpiryService>();
builder.Services.AddHostedService<ChatMessageExpiryScheduler>();
builder.Services.Configure<StockAlertRemindersOptions>(
    builder.Configuration.GetSection(StockAlertRemindersOptions.SectionName));
builder.Services.AddScoped<IStockReminderService, StockReminderService>();
builder.Services.AddHostedService<StockReminderScheduler>();
builder.Services.Configure<SubscriptionOptions>(builder.Configuration.GetSection(SubscriptionOptions.SectionName));
builder.Services.AddSingleton<ILeaseSigner, LeaseSigner>();
builder.Services.Configure<SubscriptionRemindersOptions>(builder.Configuration.GetSection(SubscriptionRemindersOptions.SectionName));
builder.Services.AddScoped<ISubscriptionReminderService, SubscriptionReminderService>();
builder.Services.AddHostedService<SubscriptionReminderScheduler>();

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddScoped<LocalImageStorage>();
    builder.Services.AddScoped<LocalReportFileStorage>();
    builder.Services.AddScoped<LocalChatImageStore>();
    builder.Services.AddScoped<IImageStorage>(sp => new TenantImageStorage(sp.GetRequiredService<LocalImageStorage>(), sp.GetRequiredService<ICurrentTenant>()));
    builder.Services.AddScoped<IReportFileStorage>(sp => new TenantReportFileStorage(sp.GetRequiredService<LocalReportFileStorage>(), sp.GetRequiredService<ICurrentTenant>()));
    builder.Services.AddScoped<IChatImageStore>(sp => new TenantChatImageStore(sp.GetRequiredService<LocalChatImageStore>(), sp.GetRequiredService<ICurrentTenant>()));
}
else
{
    builder.Services.AddScoped<AzureBlobImageStorage>();
    builder.Services.AddScoped<AzureBlobReportFileStorage>();
    builder.Services.AddSingleton<AzureBlobChatImageStore>();
    builder.Services.AddScoped<IImageStorage>(sp => new TenantImageStorage(sp.GetRequiredService<AzureBlobImageStorage>(), sp.GetRequiredService<ICurrentTenant>()));
    builder.Services.AddScoped<IReportFileStorage>(sp => new TenantReportFileStorage(sp.GetRequiredService<AzureBlobReportFileStorage>(), sp.GetRequiredService<ICurrentTenant>()));
    builder.Services.AddScoped<IChatImageStore>(sp => new TenantChatImageStore(sp.GetRequiredService<AzureBlobChatImageStore>(), sp.GetRequiredService<ICurrentTenant>()));
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

builder.Services.AddAppAuthorization();

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
            policy.SetIsOriginAllowed(origin =>
                {
                    if (string.IsNullOrWhiteSpace(origin))
                    {
                        return false;
                    }

                    if (origin.Equals("capacitor://localhost", StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }

                    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                    {
                        return false;
                    }

                    return uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                        || uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
                        || uri.Host.Equals("wtfbyfaith.runasp.net", StringComparison.OrdinalIgnoreCase)
                        || uri.Host.Equals("wtfbyfaith-staging.runasp.net", StringComparison.OrdinalIgnoreCase);
                })
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        }
    });
});

// Multiplies the public-link limits below. Always 1 in production; the browser test suite raises it because all its
// workers share one caller address.
var rateLimitMultiplier = Math.Max(1, builder.Configuration.GetValue("RateLimiting:Multiplier", 1));

builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy(PlatformEndpoints.LoginRateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "local",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10 * rateLimitMultiplier,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

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

    // Public ordering links: a limit per caller address, plus one per token so a leaked link cannot be hammered
    // from many addresses at once.
    options.AddPolicy(PublicOrderLinkEndpoints.RateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "local",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60 * rateLimitMultiplier,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Writing to the shop is tighter than reading: a few messages a minute from one address is plenty for a chat.
    options.AddPolicy(PublicOrderLinkEndpoints.ChatRateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "local",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10 * rateLimitMultiplier,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Pictures are tighter again: a handful a minute from one address.
    options.AddPolicy(PublicOrderLinkEndpoints.ChatImageRateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "local",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5 * rateLimitMultiplier,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        const string prefix = "/api/public/order-links/";
        var path = context.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return RateLimitPartition.GetNoLimiter("not-public");
        }

        var token = path[prefix.Length..].Split('/')[0];
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: $"order-link:{token}",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 120 * rateLimitMultiplier,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            });
    });

    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
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

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (KeyNotFoundException ex)
    {
        if (context.Response.HasStarted)
        {
            throw;
        }

        context.Response.Clear();
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
    catch (InvalidOperationException ex)
    {
        if (context.Response.HasStarted)
        {
            throw;
        }

        app.Logger.LogWarning(ex, "Request validation/business rule failure: {Message}", ex.Message);
        context.Response.Clear();
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
    catch (ArgumentException ex)
    {
        if (context.Response.HasStarted)
        {
            throw;
        }

        app.Logger.LogWarning(ex, "Request argument validation failure: {Message}", ex.Message);
        context.Response.Clear();
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
});

app.UseAuthentication();
app.UseMiddleware<TenantRequestGuardMiddleware>();
app.UseAuthorization();

app.MapHub<DashboardHub>("/hubs/dashboard");
app.MapHub<StaffOrderHub>("/hubs/staff-orders");
app.MapHub<NotificationHub>("/hubs/notifications");
app.MapHub<CustomerOrderHub>("/hubs/customer-orders");

app.MapAppEndpoints();

// SPA fallback: serve index.html for non-API, non-file routes
app.MapFallbackToFile("index.html");

await PlatformAdminBootstrap.RunAsync(app.Services, app.Configuration, app.Logger);

app.Run();
