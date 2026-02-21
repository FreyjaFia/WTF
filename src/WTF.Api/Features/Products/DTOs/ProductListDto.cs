namespace WTF.Api.Features.Products.DTOs;

public record ProductListDto(List<ProductDto> Products, int TotalCount, int Page, int PageSize)
{
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasPrevious => Page > 1;
    public bool HasNext => Page < TotalPages;
}
