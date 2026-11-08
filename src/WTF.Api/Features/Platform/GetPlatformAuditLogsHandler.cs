using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Features.Platform;

public record GetPlatformAuditLogsQuery(Guid? TenantId = null, int Take = 100) : IRequest<List<PlatformAuditLogDto>>;

public class GetPlatformAuditLogsHandler(WTFDbContext db) : IRequestHandler<GetPlatformAuditLogsQuery, List<PlatformAuditLogDto>>
{
    public async Task<List<PlatformAuditLogDto>> Handle(GetPlatformAuditLogsQuery request, CancellationToken cancellationToken)
    {
        var query = db.PlatformAuditLogs.AsNoTracking().AsQueryable();
        if (request.TenantId is { } tenantId)
        {
            query = query.Where(l => l.TenantId == tenantId);
        }

        return await query
            .OrderByDescending(l => l.Timestamp)
            .Take(Math.Clamp(request.Take, 1, 500))
            .Select(l => new PlatformAuditLogDto(l.Id, l.Username, l.Action, l.TenantId, l.Details, l.IpAddress, l.Timestamp))
            .ToListAsync(cancellationToken);
    }
}
