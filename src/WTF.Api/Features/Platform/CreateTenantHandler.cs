using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Subscriptions;
using WTF.Api.Features.Users.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Platform;

public record CreateTenantCommand(
    string Name,
    string Slug,
    string OwnerFirstName,
    string OwnerLastName,
    string OwnerUsername,
    bool IsTrial = false,
    string? PlanCode = null) : IRequest<CreatedTenantDto>;

public partial class CreateTenantHandler(WTFDbContext db, IPlatformAuditService audit, IOptions<SubscriptionOptions> subscriptionOptions) : IRequestHandler<CreateTenantCommand, CreatedTenantDto>
{
    public static readonly string[] ReservedSlugs =
        ["www", "api", "app", "admin", "platform", "shop", "static", "mail", "support", "login", "wtf", "test", "demo", "staging"];

    public async Task<CreatedTenantDto> Handle(CreateTenantCommand request, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        var slug = request.Slug?.Trim().ToLowerInvariant() ?? string.Empty;
        var username = request.OwnerUsername?.Trim() ?? string.Empty;
        var firstName = request.OwnerFirstName?.Trim() ?? string.Empty;
        var lastName = request.OwnerLastName?.Trim() ?? string.Empty;

        Validate(name, slug, username, firstName, lastName);

        if (await db.Tenants.AnyAsync(t => t.Slug == slug, cancellationToken)
            || await db.TenantTombstones.AnyAsync(t => t.Slug == slug, cancellationToken))
        {
            throw new InvalidOperationException("That shop address is already taken.");
        }

        var systemUsername = SubmitPublicOrderHandler.SystemUsernamePrefix + slug;
        var normalized = new[] { username.ToLowerInvariant(), systemUsername };
        if (await db.Users.IgnoreQueryFilters().AnyAsync(u => normalized.Contains(u.Username.ToLower()), cancellationToken))
        {
            throw new InvalidOperationException("Username already exists.");
        }

        var plan = request.PlanCode is { Length: > 0 } code
            ? await db.Plans.FirstOrDefaultAsync(p => p.Code == code && p.IsActive, cancellationToken)
            : await db.Plans.Where(p => p.IsActive).OrderByDescending(p => p.SortOrder).FirstOrDefaultAsync(cancellationToken);
        if (plan is null && request.PlanCode is { Length: > 0 })
        {
            throw new InvalidOperationException("Plan not found.");
        }

        var password = TemporaryPassword.Generate();
        var now = DateTime.UtcNow;
        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = name,
            Slug = slug,
            Status = request.IsTrial ? TenantAccess.Trial : TenantAccess.Active,
            CreatedAt = now
        };

        var ownerId = Guid.NewGuid();
        var systemId = Guid.NewGuid();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        db.Tenants.Add(tenant);
        await db.SaveChangesAsync(cancellationToken);

        if (plan is not null)
        {
            // A trial runs for the trial days; a paid shop gets its first month and is then invoiced from the platform page.
            var settings = subscriptionOptions.Value;
            var periodEnd = request.IsTrial ? now.AddDays(settings.TrialDays) : now.AddMonths(1);
            db.TenantSubscriptions.Add(new TenantSubscription
            {
                TenantId = tenant.Id,
                PlanId = plan.Id,
                CurrentPeriodStart = now,
                CurrentPeriodEnd = periodEnd,
                GraceDays = settings.DefaultGraceDays,
                UpdatedAt = now
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        db.UseTenant(tenant.Id);
        await Branding.BrandDefaults.SaveAsync(db, tenant.Id, Branding.BrandDefaults.For(name), cancellationToken);

        // Users.CreatedBy is a required self-reference, so each first user is created by itself.
        db.Users.Add(new User
        {
            Id = ownerId,
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            FirstName = firstName,
            LastName = lastName,
            IsActive = true,
            RoleId = (int)UserRoleEnum.SuperAdmin,
            CreatedAt = now,
            CreatedBy = ownerId,
            MustChangePassword = true
        });

        db.Users.Add(new User
        {
            Id = systemId,
            Username = systemUsername,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TemporaryPassword.Generate()),
            FirstName = "Customer",
            LastName = "Link",
            IsActive = false,
            RoleId = (int)UserRoleEnum.Cashier,
            CreatedAt = now,
            CreatedBy = ownerId
        });

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await audit.LogAsync(PlatformActions.TenantCreated, tenant.Id, $"Created '{name}' ({slug}); first user '{username}'.", cancellationToken: cancellationToken);

        var dto = new PlatformTenantDto(tenant.Id, name, slug, tenant.Status, PlatformTenantNames.StatusName(tenant.Status), now, 2, 0, null);
        return new CreatedTenantDto(dto, username, password);
    }

    private static void Validate(string name, string slug, string username, string firstName, string lastName)
    {
        if (name.Length is 0 or > 100)
        {
            throw new InvalidOperationException("Shop name is required (100 characters at most).");
        }

        if (!SlugPattern().IsMatch(slug))
        {
            throw new InvalidOperationException("Shop address must be 3 to 50 lowercase letters, numbers or dashes, and cannot start or end with a dash.");
        }

        if (ReservedSlugs.Contains(slug))
        {
            throw new InvalidOperationException("That shop address is reserved.");
        }

        if (username.Length is 0 or > 50 || firstName.Length is 0 or > 50 || lastName.Length is 0 or > 50)
        {
            throw new InvalidOperationException("Owner username, first name and last name are required (50 characters at most).");
        }
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")]
    private static partial Regex SlugPattern();
}
