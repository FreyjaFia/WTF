using WTF.Api.Common.DTOs;

namespace WTF.Tests.Common;

public sealed class PagingRequestTests
{
    [Theory]
    [InlineData(0, 0, 25, 1, 25)]
    [InlineData(-3, -1, 20, 1, 20)]
    [InlineData(2, 500, 25, 2, 100)]
    [InlineData(3, 10, 25, 3, 10)]
    public void From_clamps_page_and_page_size(int page, int size, int fallback, int expectedPage, int expectedSize)
    {
        var paging = PagingRequest.From(page, size, fallback);

        Assert.Equal(expectedPage, paging.Page);
        Assert.Equal(expectedSize, paging.PageSize);
    }

    [Fact]
    public void Skip_counts_the_rows_before_the_page()
    {
        Assert.Equal(40, new PagingRequest(3, 20).Skip);
    }

    [Theory]
    [InlineData(9, 20, 61, 4)]
    [InlineData(2, 20, 61, 2)]
    [InlineData(5, 20, 0, 1)]
    public void ClampToTotal_returns_the_last_real_page(int page, int size, int total, int expected)
    {
        Assert.Equal(expected, new PagingRequest(page, size).ClampToTotal(total).Page);
    }

    [Fact]
    public void ApplyPaging_takes_only_the_requested_slice()
    {
        var rows = Enumerable.Range(1, 61).AsQueryable();

        var page = rows.ApplyPaging(new PagingRequest(4, 20)).ToList();

        Assert.Equal([61], page);
    }
}
