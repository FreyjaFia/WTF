using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branches.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branches;

public record GetMyBranchesQuery : IRequest<MyBranchesDto>;

public record GetBranchesQuery(string? Search, string? Status) : IRequest<List<BranchDto>>;

public record GetBranchByIdQuery(Guid Id) : IRequest<BranchDto?>;

public class GetMyBranchesHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    BranchScopeCache cache,
    ICurrentTenant currentTenant) : IRequestHandler<GetMyBranchesQuery, MyBranchesDto>
{
    public async Task<MyBranchesDto> Handle(GetMyBranchesQuery request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var tenantId = db.StampTenantId ?? throw new InvalidOperationException("No shop.");
        var scope = await cache.GetUserAsync(db, userId, cancellationToken);
        var branches = await cache.GetBranchesAsync(db, tenantId, cancellationToken);
        var names = await BranchRules.AllOfShop(db).AsNoTracking()
            .Select(b => new { b.Id, b.Name, b.Code })
            .ToDictionaryAsync(b => b.Id, cancellationToken);

        var mine = branches
            .Where(b => scope.IsAll || scope.Assigned.Contains(b.Id))
            .Select(b => new MyBranchDto(b.Id, names[b.Id].Name, names[b.Id].Code, b.IsMain, b.IsActive))
            .ToList();

        var activeCount = branches.Count(b => b.IsActive);
        var usableMine = mine.Count(b => b.IsActive);
        var max = await BranchRules.MaxBranchesAsync(db, currentTenant, cancellationToken);
        var defaultId = scope.DefaultBranchId is { } preferred && mine.Any(b => b.Id == preferred && b.IsActive)
            ? preferred
            : (mine.FirstOrDefault(b => b.IsMain && b.IsActive) ?? mine.FirstOrDefault(b => b.IsActive))?.Id;

        return new MyBranchesDto(mine, defaultId, activeCount > 1, usableMine > 1, activeCount, max);
    }
}

public class GetBranchesHandler(WTFDbContext db, ICurrentBranch currentBranch) : IRequestHandler<GetBranchesQuery, List<BranchDto>>
{
    public async Task<List<BranchDto>> Handle(GetBranchesQuery request, CancellationToken cancellationToken)
    {
        return await BranchQueries.ListAsync(db, currentBranch, request.Search, request.Status, null, cancellationToken);
    }
}

public class GetBranchByIdHandler(WTFDbContext db, ICurrentBranch currentBranch) : IRequestHandler<GetBranchByIdQuery, BranchDto?>
{
    public async Task<BranchDto?> Handle(GetBranchByIdQuery request, CancellationToken cancellationToken)
    {
        return (await BranchQueries.ListAsync(db, currentBranch, null, null, request.Id, cancellationToken)).FirstOrDefault();
    }
}

internal static class BranchQueries
{
    public static async Task<List<BranchDto>> ListAsync(WTFDbContext db, ICurrentBranch currentBranch, string? search, string? status, Guid? id, CancellationToken cancellationToken)
    {
        var query = BranchRules.AllOfShop(db).AsNoTracking();
        if (BranchRules.IsLimited(currentBranch))
        {
            var allowed = currentBranch.AllowedBranchIds;
            query = query.Where(b => allowed.Contains(b.Id));
        }

        if (id is { } wanted)
        {
            query = query.Where(b => b.Id == wanted);
        }

        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            query = query.Where(b => b.Name.Contains(term) || b.Code.Contains(term) || (b.Address != null && b.Address.Contains(term)));
        }

        query = status?.ToLowerInvariant() switch
        {
            "active" => query.Where(b => b.IsActive),
            "closed" => query.Where(b => !b.IsActive),
            _ => query
        };

        var rows = await query.OrderByDescending(b => b.IsMain).ThenBy(b => b.Name).ToListAsync(cancellationToken);
        var ids = rows.Select(r => r.Id).ToList();

        var staff = await db.UserBranches.AsNoTracking()
            .Where(u => ids.Contains(u.BranchId) && u.User.IsActive)
            .GroupBy(u => u.BranchId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);

        var open = await BranchRules.AllOrdersOfShop(db).AsNoTracking()
            .Where(o => ids.Contains(o.BranchId) && BranchRules.OpenOrderStatuses.Contains(o.StatusId))
            .GroupBy(o => o.BranchId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);

        return [.. rows.Select(b => new BranchDto(b.Id, b.Name, b.Code, b.Address, b.Phone, b.IsActive, b.IsMain, staff.GetValueOrDefault(b.Id), open.GetValueOrDefault(b.Id), b.CreatedAt))];
    }
}
