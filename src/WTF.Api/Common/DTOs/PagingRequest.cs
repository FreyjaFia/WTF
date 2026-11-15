namespace WTF.Api.Common.DTOs;

public readonly record struct PagingRequest(int Page, int PageSize)
{
    public const int MaxPageSize = 100;

    public int Skip => (Page - 1) * PageSize;

    public static PagingRequest From(int page, int pageSize, int defaultPageSize)
    {
        var size = pageSize <= 0 ? defaultPageSize : Math.Min(pageSize, MaxPageSize);

        return new PagingRequest(page < 1 ? 1 : page, size);
    }

    public PagingRequest ClampToTotal(int totalCount)
    {
        var lastPage = Math.Max(1, (int)Math.Ceiling(totalCount / (double)PageSize));

        return Page > lastPage ? this with { Page = lastPage } : this;
    }
}

public static class PagingExtensions
{
    public static IQueryable<T> ApplyPaging<T>(this IQueryable<T> query, PagingRequest paging)
    {
        return query.Skip(paging.Skip).Take(paging.PageSize);
    }
}
