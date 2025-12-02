using MediatR;
using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products.Queries;

public record GetProductsQuery : IRequest<ProductListDto>
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 10;
    public string? SearchTerm { get; init; }
    public ProductTypeEnum? Type { get; init; }
    public bool? IsAddOn { get; init; }
    public bool? IsActive { get; init; } = true; // Default to active products only
}
