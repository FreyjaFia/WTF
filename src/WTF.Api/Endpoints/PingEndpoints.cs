namespace WTF.Api.Endpoints;

public static class PingEndpoints
{
    public static IEndpointRouteBuilder MapPing(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/health", () => Results.Ok())
            .ExcludeFromDescription();

        return app;
    }
}
