using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Services;

// The first platform admin comes from settings (Platform:BootstrapUsername and Platform:BootstrapPassword) and is created only
// while there is none. Take the password out of the settings after the first start.
public static class PlatformAdminBootstrap
{
    public const int MinPasswordLength = 12;

    public static async Task RunAsync(IServiceProvider services, IConfiguration configuration, ILogger logger)
    {
        var username = configuration["Platform:BootstrapUsername"]?.Trim();
        var password = configuration["Platform:BootstrapPassword"];
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            return;
        }

        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<WTFDbContext>();
            if (await db.PlatformAdmins.AnyAsync())
            {
                return;
            }

            if (username.Length > 50 || password.Length < MinPasswordLength)
            {
                logger.LogWarning("Platform bootstrap skipped: the name must be 50 characters at most and the password at least {Min} characters.", MinPasswordLength);
                return;
            }

            db.PlatformAdmins.Add(new PlatformAdmin
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            logger.LogInformation("Created the first platform admin '{Username}'.", username);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Platform bootstrap could not run (has 20261111_add_platform_admin.sql been applied?).");
        }
    }
}
