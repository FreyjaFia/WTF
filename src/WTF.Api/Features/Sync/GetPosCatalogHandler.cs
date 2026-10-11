using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Customers.DTOs;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Sync.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Sync;

public record GetPosCatalogQuery : IRequest<PosCatalogDto>;

public class GetPosCatalogHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPosCatalogQuery, PosCatalogDto>
{
    public async Task<PosCatalogDto> Handle(GetPosCatalogQuery request, CancellationToken cancellationToken)
    {
        var products = await PosCatalogLoader.LoadProductsAsync(db, httpContextAccessor, cancellationToken);
        var addOnsByProductId = await PosCatalogLoader.LoadAddOnsByProductIdAsync(
            db, httpContextAccessor, products, cancellationToken);
        var customers = await LoadCustomersAsync(cancellationToken);

        return new PosCatalogDto(products, addOnsByProductId, customers, DateTime.UtcNow);
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
                    : null,
                c.AllowOrderingLink))
            .ToListAsync(cancellationToken);
    }
}
