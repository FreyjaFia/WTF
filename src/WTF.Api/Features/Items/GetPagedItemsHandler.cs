using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Features.Items.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Items;

public sealed record GetPagedItemsQuery(
    string? SearchTerm = null,
    string? StockStatuses = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<PagedResultDto<ItemDto>>;

public sealed class GetPagedItemsHandler(WTFDbContext db)
    : IRequestHandler<GetPagedItemsQuery, PagedResultDto<ItemDto>>
{
    private const string Ok = "ok";
    private const string Warning = "warning";
    private const string Critical = "critical";

    public async Task<PagedResultDto<ItemDto>> Handle(GetPagedItemsQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var searched = ApplySearch(db.Items.AsNoTracking(), request.SearchTerm);

        // Counts for the stock chips follow the search but not the chips themselves.
        var criticalCount = await searched.CountAsync(IsCritical, cancellationToken);
        var warningCount = await searched.CountAsync(IsWarning, cancellationToken);
        var total = await searched.CountAsync(cancellationToken);
        var facets = new Dictionary<string, int>
        {
            [Ok] = total - criticalCount - warningCount,
            [Warning] = warningCount,
            [Critical] = criticalCount,
        };

        var query = ApplyStatusFilter(searched, request.StockStatuses);
        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<ItemDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var items = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(i => i.ItemBranchStocks)
                .ThenInclude(s => s.Branch)
            .Include(i => i.ProductItemLinkItems)
                .ThenInclude(l => l.Product)
            .Include(i => i.ProductItemLinkItems)
                .ThenInclude(l => l.ReplacesItem)
            .ToListAsync(cancellationToken);

        return new PagedResultDto<ItemDto>(
            [.. items.Select(item => ItemMapping.ToDto(item))], paging.Page, paging.PageSize, totalCount, facets);
    }

    private static readonly System.Linq.Expressions.Expression<Func<Item, bool>> IsCritical =
        i => i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity);

    private static readonly System.Linq.Expressions.Expression<Func<Item, bool>> IsWarning =
        i => !(i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity))
            && i.WarningQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.WarningQuantity);

    private static IQueryable<Item> ApplySearch(IQueryable<Item> query, string? searchTerm)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return query;
        }

        var search = searchTerm.Trim();

        return query.Where(i =>
            i.Name.Contains(search)
            || (i.Sku != null && i.Sku.Contains(search))
            || (i.Barcode != null && i.Barcode.Contains(search)));
    }

    // None or all of the chips ticked means every item.
    private static IQueryable<Item> ApplyStatusFilter(IQueryable<Item> query, string? stockStatuses)
    {
        var chosen = (stockStatuses ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .Where(s => s is Ok or Warning or Critical)
            .Distinct()
            .ToList();

        if (chosen.Count is 0 or 3)
        {
            return query;
        }

        var ok = chosen.Contains(Ok);
        var warning = chosen.Contains(Warning);
        var critical = chosen.Contains(Critical);

        return query.Where(i =>
            (critical && i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity))
            || (warning
                && !(i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity))
                && i.WarningQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.WarningQuantity))
            || (ok
                && !(i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity))
                && !(i.WarningQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.WarningQuantity))));
    }

    private static IQueryable<Item> ApplySort(IQueryable<Item> query, GetPagedItemsQuery request)
    {
        var descending = string.Equals(request.SortDirection, "desc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, descending) switch
        {
            ("stock", false) => query.OrderBy(i => i.ItemBranchStocks.Sum(s => s.CurrentQuantity)).ThenBy(i => i.Id),
            ("stock", true) => query.OrderByDescending(i => i.ItemBranchStocks.Sum(s => s.CurrentQuantity)).ThenByDescending(i => i.Id),
            ("cost", false) => query.OrderBy(i => i.CostPrice ?? -1m).ThenBy(i => i.Id),
            ("cost", true) => query.OrderByDescending(i => i.CostPrice ?? -1m).ThenByDescending(i => i.Id),
            ("status", false) => query.OrderBy(StatusRank).ThenBy(i => i.Name).ThenBy(i => i.Id),
            ("status", true) => query.OrderByDescending(StatusRank).ThenBy(i => i.Name).ThenBy(i => i.Id),
            (_, true) => query.OrderByDescending(i => i.Name).ThenByDescending(i => i.Id),
            _ => query.OrderBy(i => i.Name).ThenBy(i => i.Id),
        };
    }

    // Critical first, then warning, then ok, as the status column has always sorted.
    private static readonly System.Linq.Expressions.Expression<Func<Item, int>> StatusRank =
        i => i.CriticalQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.CriticalQuantity) ? 0
            : i.WarningQuantity != null && i.ItemBranchStocks.Any(s => s.CurrentQuantity <= i.WarningQuantity) ? 1
            : 2;
}
