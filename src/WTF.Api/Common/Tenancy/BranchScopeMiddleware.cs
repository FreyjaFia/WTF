using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Common.Tenancy;

// Works out which branches the signed-in user may use and which one they are working in (the X-Branch-Id header, "all" for
// reading everything they may see, otherwise their default branch). The data layer reads the result, so a handler that forgets
// to filter by branch still cannot reach another branch.
public sealed class BranchScopeMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Branch-Id";
    public const string AllBranchesValue = "all";
    public const string NoBranchMessage = "Ask the owner to assign you to a branch.";
    public const string PickBranchMessage = "Pick a branch first.";
    public const string BranchNotAllowedMessage = "You cannot use that branch.";
    public const string BadBranchHeaderMessage = "The branch you picked is not valid. Pick a branch again.";

    public async Task InvokeAsync(HttpContext context, BranchScopeCache cache, CurrentBranch currentBranch)
    {
        var user = context.User;
        if (user.Identity?.IsAuthenticated != true
            || user.IsInRole(AppRoles.PlatformAdmin)
            || !Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId)
            || !Guid.TryParse(user.FindFirst(TenantDefaults.ClaimType)?.Value, out var tenantId))
        {
            await next(context);
            return;
        }

        var db = context.RequestServices.GetRequiredService<WTFDbContext>();
        var scope = await cache.GetUserAsync(db, userId, context.RequestAborted);
        var branches = await cache.GetBranchesAsync(db, tenantId, context.RequestAborted);

        var allowed = branches.Where(b => scope.IsAll || scope.Assigned.Contains(b.Id)).ToList();
        var isRead = HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method) || HttpMethods.IsOptions(context.Request.Method);
        var exempt = context.Request.Path.StartsWithSegments("/api/auth") || context.Request.Path.StartsWithSegments("/hubs");
        var usable = allowed.Where(b => b.IsActive).ToList();

        if (usable.Count == 0 && allowed.Count == 0)
        {
            if (exempt)
            {
                await next(context);
                return;
            }

            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = NoBranchMessage });
            return;
        }

        var header = context.Request.Headers[HeaderName].ToString().Trim();
        var allIds = allowed.Select(b => b.Id).ToList();

        if (string.Equals(header, AllBranchesValue, StringComparison.OrdinalIgnoreCase))
        {
            if (!isRead && !exempt)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(new { message = PickBranchMessage });
                return;
            }

            currentBranch.Resolve(allIds, !scope.IsAll, null, true);
            await next(context);
            return;
        }

        var ignoreHeader = context.Request.Path.Equals("/api/branches/mine", StringComparison.OrdinalIgnoreCase);

        // A header that is not a branch id (garbage, or sent twice) must not quietly send the work to the default branch.
        if (header.Length > 0 && !Guid.TryParse(header, out _) && !ignoreHeader && !exempt)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { message = BadBranchHeaderMessage });
            return;
        }

        Guid? active;
        if (Guid.TryParse(header, out var requested) && !ignoreHeader)
        {
            var match = allowed.FirstOrDefault(b => b.Id == requested);
            if (match is null || (!match.IsActive && !isRead))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { message = BranchNotAllowedMessage });
                return;
            }

            active = requested;
        }
        else
        {
            active = scope.DefaultBranchId is { } preferred && usable.Any(b => b.Id == preferred)
                ? preferred
                : (usable.FirstOrDefault(b => b.IsMain) ?? usable.FirstOrDefault() ?? allowed[0]).Id;
        }

        currentBranch.Resolve(allIds, !scope.IsAll, active, false);
        await next(context);
    }
}
