using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NSubstitute;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using WTF.Api.Common.Auth;
using WTF.Api.Endpoints;
using WTF.Api.Features.Reports;
using WTF.Domain.Data;

namespace WTF.Tests.Endpoints;

/// <summary>Builds the real route table and authorization policies in memory (no server, no database).</summary>
internal sealed class EndpointTestHost : IDisposable
{
    public sealed record Route(string Method, string Pattern, string[] Policies, bool RequiresAuth, bool AllowsAnonymous)
    {
        /// <summary>"GET /api/orders/ => OrdersRead", "... => authenticated" or "... => anonymous".</summary>
        public string Description => $"{Method} {Pattern} => {Access}";

        public string Access => Policies.Length > 0
            ? string.Join("+", Policies)
            : RequiresAuth && !AllowsAnonymous ? "authenticated" : "anonymous";
    }

    private readonly List<RouteEndpoint> _endpoints;

    public WebApplication App { get; }
    public ISender Sender { get; } = Substitute.For<ISender>();
    public IMediator Mediator { get; } = Substitute.For<IMediator>();
    public IReadOnlyList<Route> Routes { get; }

    public EndpointTestHost()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = Environments.Production });
        builder.Services.AddAppAuthorization();
        builder.Services.AddRateLimiter(_ => { });
        // Surface binding failures as exceptions instead of silent 400s so tests can tell them apart.
        builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(EndpointRegistration).Assembly));
        // Handlers never run for real; these are registered so parameter binding recognises them.
        builder.Services.AddDbContext<WTFDbContext>(o => o.UseSqlServer("Server=unused;Database=unused"));
        builder.Services.AddSingleton(Substitute.For<IMonthlyReportWorkbookService>());
        builder.Services.AddSingleton(Sender);
        builder.Services.AddSingleton(Mediator);
        App = builder.Build();
        App.MapAppEndpoints();

        _endpoints = ((IEndpointRouteBuilder)App).DataSources
            .SelectMany(ds => ds.Endpoints)
            .OfType<RouteEndpoint>()
            .ToList();

        Routes = _endpoints
            .SelectMany(endpoint =>
            {
                var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [];
                var authorize = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>();
                var policies = authorize.Select(a => a.Policy).Where(p => !string.IsNullOrEmpty(p)).Cast<string>().ToArray();
                var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
                return methods.Select(m => new Route(m, endpoint.RoutePattern.RawText ?? "", policies, authorize.Count > 0, anonymous));
            })
            .OrderBy(r => r.Pattern, StringComparer.Ordinal)
            .ThenBy(r => r.Method, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Calls the real endpoint delegate with a fake request and returns the status and body.</summary>
    public async Task<(int Status, string Body)> InvokeAsync(
        string method,
        string pattern,
        IDictionary<string, object>? routeValues = null,
        string? query = null,
        object? jsonBody = null,
        ClaimsPrincipal? user = null,
        IDictionary<string, string>? headers = null)
    {
        var endpoint = _endpoints.Single(e =>
            e.RoutePattern.RawText == pattern
            && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

        using var scope = App.Services.CreateScope();
        var context = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
        context.Request.Method = method;
        context.Request.QueryString = new QueryString(string.IsNullOrEmpty(query) ? "" : "?" + query);
        foreach (var (key, value) in routeValues ?? new Dictionary<string, object>())
        {
            context.Request.RouteValues[key] = value.ToString();
        }

        if (jsonBody is not null)
        {
            context.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature>(new BodyDetection());
            context.Request.ContentType = "application/json";
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(jsonBody, JsonSerializerOptions.Web)));
        }

        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
        {
            context.Request.Headers[name] = value;
        }

        if (user is not null)
        {
            context.User = user;
        }

        context.Response.Body = new MemoryStream();
        context.SetEndpoint(endpoint);
        await endpoint.RequestDelegate!(context);

        context.Response.Body.Position = 0;
        return (context.Response.StatusCode, await new StreamReader(context.Response.Body).ReadToEndAsync());
    }

    public void Dispose() => ((IDisposable)App).Dispose();
}
