using WTF.Api.Common.Auth;
using WTF.Api.Features.Platform;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

// Runs after sign-in checks: stops requests of a suspended or cancelled shop, and keeps "signed in as a shop user" sessions
// read-only (by default), away from passwords, and on the platform audit trail.
public sealed class TenantRequestGuardMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, TenantStatusCache statusCache)
    {
        var user = context.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        if (Guid.TryParse(user.FindFirst(TenantDefaults.ClaimType)?.Value, out var tenantId))
        {
            var db = context.RequestServices.GetRequiredService<WTFDbContext>();
            if (OfflineSyncWindow.IsOfflineSyncRoute(context.Request) && await statusCache.ClosedSinceAsync(db, tenantId, context.RequestAborted) is { } closedSince)
            {
                // Orders sold before the shop closed may still arrive; the handler checks each order's time against this cut-off.
                OfflineSyncWindow.Open(context, closedSince);
                await next(context);
                return;
            }

            if (!await statusCache.CanUseAsync(db, tenantId, context.RequestAborted))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { message = TenantAccess.SuspendedMessage });
                return;
            }
        }

        if (Guid.TryParse(user.FindFirst(TenantDefaults.ClaimType)?.Value, out var paidTenantId)
            && !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) && !HttpMethods.IsOptions(context.Request.Method)
            && !context.Request.Path.StartsWithSegments("/api/auth") && !context.Request.Path.StartsWithSegments("/hubs"))
        {
            var db = context.RequestServices.GetRequiredService<WTFDbContext>();
            if (await statusCache.IsLapsedAsync(db, paidTenantId, context.RequestAborted))
            {
                context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
                await context.Response.WriteAsJsonAsync(new { message = TenantAccess.SubscriptionEndedMessage });
                return;
            }
        }

        if (user.FindFirst(ImpersonationClaims.By) is not null && !await AllowImpersonatedRequestAsync(context))
        {
            return;
        }

        await next(context);
    }

    private static async Task<bool> AllowImpersonatedRequestAsync(HttpContext context)
    {
        var method = context.Request.Method;
        var path = context.Request.Path;
        var isSafe = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

        if (isSafe || path.StartsWithSegments("/hubs"))
        {
            return true;
        }

        var readOnly = context.User.FindFirst(ImpersonationClaims.ReadOnly)?.Value != "0";
        var touchesAccounts = path.StartsWithSegments("/api/auth") || path.StartsWithSegments("/api/users");

        if (readOnly || touchesAccounts)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                message = touchesAccounts
                    ? "Passwords and accounts cannot be changed while signed in as another person."
                    : "This session is read-only."
            });
            return false;
        }

        var audit = context.RequestServices.GetRequiredService<IPlatformAuditService>();
        Guid.TryParse(context.User.FindFirst(TenantDefaults.ClaimType)?.Value, out var tenantId);
        await audit.LogAsync(
            PlatformActions.ImpersonatedAction,
            tenantId == Guid.Empty ? null : tenantId,
            $"{method} {path} as '{context.User.Identity?.Name}'",
            cancellationToken: context.RequestAborted);
        return true;
    }
}
