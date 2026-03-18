using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using WTF.Api.Common.Extensions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Endpoints;

public static class PushNotificationEndpoints
{
    private const string PlatformWeb = "web";
    private const string PlatformAndroid = "android";
    private static readonly HashSet<string> AllowedPlatforms =
        new(StringComparer.OrdinalIgnoreCase) { PlatformWeb, PlatformAndroid };

    public static IEndpointRouteBuilder MapPushNotifications(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/push")
            .RequireAuthorization();

        group.MapPost("/subscribe",
            async (
                HttpContext httpContext,
                PushTokenRequest request,
                WTFDbContext db,
                CancellationToken cancellationToken) =>
            {
                if (string.IsNullOrWhiteSpace(request.Token))
                {
                    return Results.BadRequest("token is required.");
                }

                if (string.IsNullOrWhiteSpace(request.Platform)
                    || !AllowedPlatforms.Contains(request.Platform))
                {
                    return Results.BadRequest("platform must be 'web' or 'android'.");
                }

                var userId = httpContext.User.GetUserId();
                var now = DateTime.UtcNow;
                var normalizedToken = request.Token.Trim();
                var normalizedPlatform = request.Platform.Trim().ToLowerInvariant();
                var deviceId = string.IsNullOrWhiteSpace(request.DeviceId) ? null : request.DeviceId.Trim();

                if (normalizedPlatform == PlatformWeb)
                {
                    await db.PushNotificationTokens
                        .Where(t => t.UserId == userId
                            && t.Platform == PlatformWeb
                            && t.Token != normalizedToken
                            && t.IsActive)
                        .ExecuteUpdateAsync(setters => setters
                            .SetProperty(t => t.IsActive, false)
                            .SetProperty(t => t.LastSeenAt, now), cancellationToken);
                }
                else if (normalizedPlatform == PlatformAndroid && !string.IsNullOrWhiteSpace(deviceId))
                {
                    await db.PushNotificationTokens
                        .Where(t => t.UserId == userId
                            && t.Platform == PlatformAndroid
                            && t.DeviceId == deviceId
                            && t.Token != normalizedToken
                            && t.IsActive)
                        .ExecuteUpdateAsync(setters => setters
                            .SetProperty(t => t.IsActive, false)
                            .SetProperty(t => t.LastSeenAt, now), cancellationToken);
                }

                var updated = await db.PushNotificationTokens
                    .Where(t => t.Token == normalizedToken)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(t => t.UserId, userId)
                        .SetProperty(t => t.Platform, normalizedPlatform)
                        .SetProperty(t => t.DeviceId, deviceId)
                        .SetProperty(t => t.IsActive, true)
                        .SetProperty(t => t.LastSeenAt, now), cancellationToken);

                if (updated == 0)
                {
                    var entity = new PushNotificationToken
                    {
                        UserId = userId,
                        Platform = normalizedPlatform,
                        Token = normalizedToken,
                        DeviceId = deviceId,
                        IsActive = true,
                        CreatedAt = now,
                        LastSeenAt = now,
                    };

                    db.PushNotificationTokens.Add(entity);

                    try
                    {
                        await db.SaveChangesAsync(cancellationToken);
                    }
                    catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
                    {
                        await db.PushNotificationTokens
                            .Where(t => t.Token == normalizedToken)
                            .ExecuteUpdateAsync(setters => setters
                                .SetProperty(t => t.UserId, userId)
                                .SetProperty(t => t.Platform, normalizedPlatform)
                                .SetProperty(t => t.DeviceId, deviceId)
                                .SetProperty(t => t.IsActive, true)
                                .SetProperty(t => t.LastSeenAt, now), cancellationToken);
                    }
                }

                return Results.Ok();
            });

        group.MapPost("/unsubscribe",
            async (
                HttpContext httpContext,
                PushTokenRequest request,
                WTFDbContext db,
                CancellationToken cancellationToken) =>
            {
                if (string.IsNullOrWhiteSpace(request.Token))
                {
                    return Results.BadRequest("token is required.");
                }

                var userId = httpContext.User.GetUserId();
                var normalizedToken = request.Token.Trim();
                var existing = await db.PushNotificationTokens
                    .FirstOrDefaultAsync(t => t.Token == normalizedToken && t.UserId == userId, cancellationToken);

                if (existing is null)
                {
                    return Results.Ok();
                }

                existing.IsActive = false;
                existing.LastSeenAt = DateTime.UtcNow;
                await db.SaveChangesAsync(cancellationToken);
                return Results.Ok();
            });

        return app;
    }

    private sealed record PushTokenRequest(string Token, string Platform, string? DeviceId);
    private static bool IsUniqueConstraintViolation(DbUpdateException exception)
    {
        if (exception.InnerException is not SqlException sqlException)
        {
            return false;
        }

        return sqlException.Number is 2601 or 2627;
    }
}
