using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using WTF.Api.Endpoints;
using WTF.Api.Features.Loyalty.GetLoyaltyPoints;
using WTF.Domain.Data;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddDbContext<WTFDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("WtfDb")));

builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(GetLoyaltyPointsQuery).Assembly));

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowUI", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod());
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

app.UseHttpsRedirection();

app.MapGet("/", () => "Welcome to the WTFAPI!");
app.MapLoyalty();

app.Run();