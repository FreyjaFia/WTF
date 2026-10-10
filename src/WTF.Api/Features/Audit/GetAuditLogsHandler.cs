using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Audit;

public sealed record GetAuditLogsQuery : IRequest<PagedResultDto<AuditLogDto>>
{
    public Guid? UserId { get; init; }
    public string? Action { get; init; }
    public string[]? Actions { get; init; }
    public string? EntityType { get; init; }
    public string? EntityId { get; init; }
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }

    /// <summary>Every requested action: the repeated <c>actions</c> values plus the single <c>action</c>.</summary>
    public IReadOnlyList<string> GetActions()
    {
        return (Actions ?? [])
            .Append(Action)
            .Where(action => !string.IsNullOrWhiteSpace(action))
            .Select(action => action!.Trim())
            .Distinct()
            .ToList();
    }
}

public sealed class GetAuditLogsHandler(WTFDbContext db) : IRequestHandler<GetAuditLogsQuery, PagedResultDto<AuditLogDto>>
{
    public async Task<PagedResultDto<AuditLogDto>> Handle(GetAuditLogsQuery request, CancellationToken cancellationToken)
    {
        var query = db.AuditLogs
            .AsNoTracking()
            .Include(a => a.User)
            .AsQueryable();

        if (request.UserId.HasValue)
        {
            query = query.Where(a => a.UserId == request.UserId.Value);
        }

        var actions = request.GetActions();
        if (actions.Count == 1)
        {
            var action = actions[0];
            query = query.Where(a => a.Action == action);
        }
        else if (actions.Count > 1)
        {
            var actionList = actions.ToArray();
            query = query.Where(a => actionList.Contains(a.Action));
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

        var items = await orderedQuery.ToListAsync(cancellationToken);
        var page = 1;
        var pageSize = totalCount == 0 ? 1 : totalCount;

        return new PagedResultDto<AuditLogDto>(items, page, pageSize, totalCount);
    }
}
