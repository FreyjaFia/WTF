using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Api.Features.Sync.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Sync;

public record GetPosCatalogQuery : IRequest<PosCatalogDto>;

public class GetPosCatalogHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPosCatalogQuery, PosCatalogDto>
{
    public async Task<PosCatalogDto> Handle(GetPosCatalogQuery request, CancellationToken cancellationToken)
    {
        var products = await LoadProductsAsync(cancellationToken);
        var addOnsByProductId = await LoadAddOnsByProductIdAsync(products, cancellationToken);
        var customers = await LoadCustomersAsync(cancellationToken);

        return new PosCatalogDto(products, addOnsByProductId, customers, DateTime.UtcNow);
    }

    private async Task<List<ProductDto>> LoadProductsAsync(CancellationToken cancellationToken)
    {
        var products = await db.Products
            .Where(p => !p.IsAddOn && p.IsActive)
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .OrderBy(p => p.Name)
            .ToListAsync(cancellationToken);

        var productIds = products.Select(p => p.Id).ToList();

        var addOnCounts = await db.ProductAddOns
            .Where(pa => productIds.Contains(pa.ProductId))
            .GroupBy(pa => pa.ProductId)
            .Select(g => new { ProductId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ProductId, x => x.Count, cancellationToken);

        return [.. products.Select(p =>
        {
            var imageUrl = p.ProductImage?.Image != null
                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, p.ProductImage.Image.ImageUrl)
                : null;

            return new ProductDto(
                p.Id, p.Name, p.Code, p.Description, p.Price,
                (ProductCategoryEnum)p.CategoryId,
                p.SubCategoryId.HasValue ? (ProductSubCategoryEnum)p.SubCategoryId.Value : null,
                p.IsAddOn, p.IsActive, p.CreatedAt, p.CreatedBy, p.UpdatedAt, p.UpdatedBy,
                imageUrl, [],
                AddOnCount: addOnCounts.GetValueOrDefault(p.Id));
        })];
    }

    private async Task<Dictionary<Guid, List<AddOnGroupDto>>> LoadAddOnsByProductIdAsync(
        List<ProductDto> products, CancellationToken cancellationToken)
    {
        var productIds = products.Select(p => p.Id).ToList();

        var allAddOns = await db.ProductAddOns
            .Where(pa => productIds.Contains(pa.ProductId))
            .Include(pa => pa.AddOn)
                .ThenInclude(a => a.ProductImage)
                    .ThenInclude(pi => pi!.Image)
            .Include(pa => pa.ProductAddOnPriceOverride)
            .Where(pa => pa.AddOn.IsActive)
            .Select(pa => new
            {
                pa.ProductId,
                AddOnType = (AddOnTypeEnum)(pa.AddOnTypeId ?? (int)AddOnTypeEnum.Extra),
                pa.AddOn,
                OverridePrice = pa.ProductAddOnPriceOverride != null && pa.ProductAddOnPriceOverride.IsActive
                    ? (decimal?)pa.ProductAddOnPriceOverride.Price
                    : null
            })
            .ToListAsync(cancellationToken);

        return allAddOns
            .GroupBy(a => a.ProductId)
            .ToDictionary(
                productGroup => productGroup.Key,
                productGroup => productGroup
                    .GroupBy(a => a.AddOnType)
                    .Select(typeGroup => new AddOnGroupDto(
                        typeGroup.Key,
                        typeGroup.Key.ToString(),
                        [.. typeGroup.Select(item =>
                        {
                            var imageUrl = item.AddOn.ProductImage?.Image != null
                                ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, item.AddOn.ProductImage.Image.ImageUrl)
                                : null;

                            return new ProductDto(
                                item.AddOn.Id, item.AddOn.Name, item.AddOn.Code, item.AddOn.Description,
                                item.AddOn.Price,
                                (ProductCategoryEnum)item.AddOn.CategoryId,
                                item.AddOn.SubCategoryId.HasValue ? (ProductSubCategoryEnum)item.AddOn.SubCategoryId.Value : null,
                                item.AddOn.IsAddOn, item.AddOn.IsActive,
                                item.AddOn.CreatedAt, item.AddOn.CreatedBy, item.AddOn.UpdatedAt, item.AddOn.UpdatedBy,
                                imageUrl, [],
                                OverridePrice: item.OverridePrice);
                        })]
                    ))
                    .OrderBy(g => g.Type)
                    .ToList()
            );
    }

    private async Task<List<CustomerDto>> LoadCustomersAsync(CancellationToken cancellationToken)
    {
        return await db.Customers
            .Where(c => c.IsActive)
            .Include(c => c.CustomerImage)
                .ThenInclude(ci => ci!.Image)
            .OrderBy(c => c.FirstName)
            .ThenBy(c => c.LastName)
            .Select(c => new CustomerDto(
                c.Id, c.FirstName, c.LastName, c.Address, c.IsActive,
                c.CreatedAt, c.CreatedBy, c.UpdatedAt, c.UpdatedBy,
                c.CustomerImage != null && c.CustomerImage.Image != null
                    ? UrlExtensions.ToAbsoluteUrl(httpContextAccessor, c.CustomerImage.Image.ImageUrl)
                    : null))
            .ToListAsync(cancellationToken);
    }
}
