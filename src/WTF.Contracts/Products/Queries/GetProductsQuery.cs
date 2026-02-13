using MediatR;
using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products.Queries;

public record GetProductsQuery : IRequest<List<ProductDto>>
{
    public string? SearchTerm { get; init; }
    public ProductCategoryEnum? Category { get; init; }
    public bool? IsAddOn { get; init; }
    public bool? IsActive { get; init; } = true;
}
