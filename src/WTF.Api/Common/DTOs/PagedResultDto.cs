namespace WTF.Api.Common.DTOs;

public sealed record PagedResultDto<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount,
    IReadOnlyDictionary<string, int>? Facets = null
);
