using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Audit;

public sealed record GetAuditLogsQuery : IRequest<PagedResultDto<AuditLogDto>>
{
    public Guid? UserId { get; init; }
    public string? Action { get; init; }
    public string? EntityType { get; init; }
    public string? EntityId { get; init; }
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}

public sealed class GetAuditLogsHandler(WTFDbContext db) : IRequestHandler<GetAuditLogsQuery, PagedResultDto<AuditLogDto>>
{
    private const int MaxPageSize = 100;

    public async Task<PagedResultDto<AuditLogDto>> Handle(GetAuditLogsQuery request, CancellationToken cancellationToken)
    {
        var hasPaging = request.Page.HasValue || request.PageSize.HasValue;
        var page = request.Page is null || request.Page < 1 ? 1 : request.Page.Value;
        var pageSize = request.PageSize is null || request.PageSize < 1
            ? 20
            : Math.Min(request.PageSize.Value, MaxPageSize);

        var query = db.AuditLogs
            .AsNoTracking()
            .Include(a => a.User)
            .AsQueryable();

        if (request.UserId.HasValue)
        {
            query = query.Where(a => a.UserId == request.UserId.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.Action))
        {
            query = query.Where(a => a.Action == request.Action);
        }

        if (!string.IsNullOrWhiteSpace(request.EntityType))
        {
            query = query.Where(a => a.EntityType == request.EntityType);
        }

        if (!string.IsNullOrWhiteSpace(request.EntityId))
        {
            query = query.Where(a => a.EntityId == request.EntityId);
        }

        if (request.FromDate.HasValue)
        {
            var fromUtc = DateTime.SpecifyKind(request.FromDate.Value, DateTimeKind.Utc);
            query = query.Where(a => a.Timestamp >= fromUtc);
        }

        if (request.ToDate.HasValue)
        {
            var toUtc = DateTime.SpecifyKind(request.ToDate.Value, DateTimeKind.Utc);
            query = query.Where(a => a.Timestamp <= toUtc);
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var orderedQuery = query
            .OrderByDescending(a => a.Timestamp)
            .Select(a => new AuditLogDto(
                a.Id,
                a.UserId,
                $"{a.User.FirstName} {a.User.LastName}".Trim(),
                a.Action,
                a.EntityType,
                a.EntityId,
                a.OldValues,
                a.NewValues,
                a.IpAddress,
                a.Timestamp));

        var items = hasPaging
            ? await orderedQuery
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(cancellationToken)
            : await orderedQuery.ToListAsync(cancellationToken);

        if (!hasPaging)
        {
            page = 1;
            pageSize = totalCount == 0 ? 1 : totalCount;
        }

        return new PagedResultDto<AuditLogDto>(items, page, pageSize, totalCount);
    }
}
