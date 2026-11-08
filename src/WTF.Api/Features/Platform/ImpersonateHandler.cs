using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Tenancy;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record ImpersonateCommand(Guid TenantId, Guid UserId, string Reason, bool AllowWrites = false) : IRequest<ImpersonationDto>;

public class ImpersonateHandler(
    WTFDbContext db,
    IJwtService jwtService,
    IPlatformAuditService audit,
    IHttpContextAccessor httpContextAccessor,
    TimeProvider clock)
    : IRequestHandler<ImpersonateCommand, ImpersonationDto>
{
    public const int Minutes = 30;

    public async Task<ImpersonationDto> Handle(ImpersonateCommand request, CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length < 5)
        {
            throw new InvalidOperationException("Write a reason (at least 5 characters).");
        }

        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TenantId, cancellationToken)
            ?? throw new KeyNotFoundException("Shop not found.");

        if (!TenantAccess.CanUse(tenant.Status))
        {
            throw new InvalidOperationException("Resume the shop before signing in as one of its users.");
        }

        var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Id == request.UserId && u.TenantId == request.TenantId && u.IsActive, cancellationToken)
            ?? throw new KeyNotFoundException("User not found in this shop.");

        if (user.Username.StartsWith(Features.OrderLinks.SubmitPublicOrderHandler.SystemUsername, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("That is a system account.");
        }

        var admin = PlatformCaller.Resolve(httpContextAccessor);
        var readOnly = !request.AllowWrites;
        var token = jwtService.GenerateImpersonationToken(user, user.Role.Name, admin.Id, admin.Username, readOnly, Minutes);

        await audit.LogAsync(
            PlatformActions.ImpersonationStarted,
            tenant.Id,
            $"As '{user.Username}' ({(readOnly ? "read-only" : "can change data")}) for {Minutes} minutes. Reason: {reason}",
            cancellationToken: cancellationToken);

        return new ImpersonationDto(token, clock.GetUtcNow().UtcDateTime.AddMinutes(Minutes), user.Username, tenant.Name, readOnly);
    }
}
