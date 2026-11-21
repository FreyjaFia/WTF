using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Products.DTOs;
using WTF.Calculations.Catalog;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public sealed record GetPagedProductsQuery(
    string? SearchTerm = null,
    int[]? Categories = null,
    bool? IsActive = null,
    bool? IsAddOn = null,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25,
    Guid? SoldAtBranchId = null,
    bool? LimitedOnly = null) : IRequest<PagedResultDto<ProductDto>>;

public sealed class GetPagedProductsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetPagedProductsQuery, PagedResultDto<ProductDto>>
{
    public async Task<PagedResultDto<ProductDto>> Handle(GetPagedProductsQuery request, CancellationToken cancellationToken)
    {
        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var searched = db.Products.AsQueryable();

        if (request.IsAddOn.HasValue)
        {
            searched = searched.Where(p => p.IsAddOn == request.IsAddOn.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var term = request.SearchTerm.Trim().ToLower();
            searched = searched.Where(p => p.Name.ToLower().Contains(term));
        }

        var categories = request.Categories is { Length: > 0 } ? request.Categories : null;
        var withCategories = categories is null ? searched : searched.Where(p => categories.Contains(p.CategoryId));
        var withStatus = request.IsActive.HasValue ? searched.Where(p => p.IsActive == request.IsActive.Value) : searched;

        // Each group of chips counts with every filter except its own.
        var statusCounts = await withCategories
            .GroupBy(p => p.IsActive)
            .Select(g => new { IsActive = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var categoryCounts = await withStatus
            .GroupBy(p => p.CategoryId)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var facets = new Dictionary<string, int>
        {
            ["active"] = statusCounts.Where(c => c.IsActive).Sum(c => c.Count),
            ["inactive"] = statusCounts.Where(c => !c.IsActive).Sum(c => c.Count),
        };
        foreach (var count in categoryCounts)
        {
            facets[$"category:{count.CategoryId}"] = count.Count;
        }

        var filtered = categories is null ? withStatus : withStatus.Where(p => categories.Contains(p.CategoryId));

        // "Sold at" chips count with every filter except their own. A product with no branch rows is sold everywhere.
        var soldAt = await ProductBranchLookup.SoldAtAsync(db, null, cancellationToken);
        var visibleIds = await filtered.Select(p => p.Id).ToListAsync(cancellationToken);
        facets["soldat:limited"] = visibleIds.Count(id => soldAt.ContainsKey(id));
        var shopBranchIds = await BranchRules.AllOfShop(db).Where(b => b.IsActive).Select(b => b.Id).ToListAsync(cancellationToken);
        foreach (var branchId in shopBranchIds)
        {
            facets[$"soldat:{branchId}"] = visibleIds.Count(id => ProductAvailability.IsSoldAt(soldAt.GetValueOrDefault(id) ?? [], branchId));
        }

        var query = filtered;
        if (request.SoldAtBranchId is { } soldAtBranch)
        {
            query = query.Where(p => !db.ProductBranches.Any(x => x.ProductId == p.Id)
                || db.ProductBranches.Any(x => x.ProductId == p.Id && x.BranchId == soldAtBranch));
        }

        if (request.LimitedOnly == true)
        {
            query = query.Where(p => db.ProductBranches.Any(x => x.ProductId == p.Id));
        }

        var totalCount = await query.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new PagedResultDto<ProductDto>([], paging.Page, paging.PageSize, 0, facets);
        }

        paging = paging.ClampToTotal(totalCount);

        var products = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var items = await ProductListMapper.MapAsync(db, httpContextAccessor, products, request.IsAddOn, cancellationToken);

        return new PagedResultDto<ProductDto>(items, paging.Page, paging.PageSize, totalCount, facets);
    }

    private static IQueryable<Product> ApplySort(IQueryable<Product> query, GetPagedProductsQuery request)
    {
        var descending = string.Equals(request.SortDirection, "desc", StringComparison.OrdinalIgnoreCase);

        if (string.Equals(request.SortBy, "price", StringComparison.OrdinalIgnoreCase))
        {
            return descending
                ? query.OrderByDescending(p => p.Price).ThenByDescending(p => p.Id)
                : query.OrderBy(p => p.Price).ThenBy(p => p.Id);
        }

        return descending
            ? query.OrderByDescending(p => p.Name).ThenByDescending(p => p.Id)
            : query.OrderBy(p => p.Name).ThenBy(p => p.Id);
    }
}
