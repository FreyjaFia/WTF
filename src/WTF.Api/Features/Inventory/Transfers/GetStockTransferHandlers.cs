using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Transfers;

public record GetStockTransferQuery(Guid Id) : IRequest<StockTransferDto?>;

public sealed record GetPagedStockTransfersQuery(
    string? Direction = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<StockTransferSummaryDto>>;

public class GetStockTransferHandler(WTFDbContext db) : IRequestHandler<GetStockTransferQuery, StockTransferDto?>
{
    public async Task<StockTransferDto?> Handle(GetStockTransferQuery request, CancellationToken cancellationToken)
    {
        var summary = await StockTransferQueries.Summaries(db, db.StockTransfers.AsNoTracking().Where(t => t.Id == request.Id))
            .FirstOrDefaultAsync(cancellationToken);
        if (summary is null)
        {
            return null;
        }

        var lines = await db.StockTransferLines
            .AsNoTracking()
            .Where(l => l.TransferId == request.Id)
            .OrderBy(l => l.Item.Name)
            .Select(l => new StockTransferLineDto(l.ItemId, l.Item.Name, l.Item.UnitName, l.Quantity, l.UnitCost))
            .ToListAsync(cancellationToken);

        return new StockTransferDto(summary, lines);
    }
}

public sealed class GetPagedStockTransfersHandler(WTFDbContext db)
    : IRequestHandler<GetPagedStockTransfersQuery, PagedResultDto<StockTransferSummaryDto>>
{
    public async Task<PagedResultDto<StockTransferSummaryDto>> Handle(GetPagedStockTransfersQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var query = db.StockTransfers.AsNoTracking().AsQueryable();

        // "Sent" and "received" are from the point of view of the branch the person works in.
        var active = db.ActiveBranchId;
        if (active is { } branchId)
        {
            query = request.Direction?.ToLowerInvariant() switch
            {
                "sent" => query.Where(t => t.FromBranchId == branchId),
                "received" => query.Where(t => t.ToBranchId == branchId),
                _ => query
            };
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<StockTransferSummaryDto>([], paging.Page, paging.PageSize, 0);
        }

        paging = paging.ClampToTotal(totalCount);
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var ordered = (request.SortBy?.Trim().ToLowerInvariant(), ascending) switch
        {
            ("from", true) => query.OrderBy(t => t.FromBranch.Name).ThenBy(t => t.Id),
            ("from", false) => query.OrderByDescending(t => t.FromBranch.Name).ThenByDescending(t => t.Id),
            ("to", true) => query.OrderBy(t => t.ToBranch.Name).ThenBy(t => t.Id),
            ("to", false) => query.OrderByDescending(t => t.ToBranch.Name).ThenByDescending(t => t.Id),
            ("items", true) => query.OrderBy(t => t.StockTransferLines.Count).ThenBy(t => t.Id),
            ("items", false) => query.OrderByDescending(t => t.StockTransferLines.Count).ThenByDescending(t => t.Id),
            ("created", true) => query.OrderBy(t => t.CreatedAt).ThenBy(t => t.Id),
            _ => query.OrderByDescending(t => t.CreatedAt).ThenByDescending(t => t.Id)
        };

        var items = await StockTransferQueries.Summaries(db, ordered.ApplyPaging(paging)).ToListAsync(cancellationToken);
        return new PagedResultDto<StockTransferSummaryDto>(items, paging.Page, paging.PageSize, totalCount);
    }
}

internal static class StockTransferQueries
{
    // The branch names come through the shop's own branches, not the person's, so a limited person still sees where goods went.
    public static IQueryable<StockTransferSummaryDto> Summaries(WTFDbContext db, IQueryable<StockTransfer> transfers)
    {
        return transfers.Select(t => new StockTransferSummaryDto(
            t.Id,
            t.FromBranchId,
            t.FromBranch.Code,
            t.FromBranch.Name,
            t.ToBranchId,
            t.ToBranch.Code,
            t.ToBranch.Name,
            t.Notes,
            t.CreatedAt,
            t.CreatedByNavigation.FirstName + " " + t.CreatedByNavigation.LastName,
            t.StockTransferLines.Count,
            t.StockTransferLines.Sum(l => l.Quantity)));
    }
}
