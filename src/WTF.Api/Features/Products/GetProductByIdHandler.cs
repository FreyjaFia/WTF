using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Features.Products.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record GetProductByIdQuery(Guid Id) : IRequest<ProductDto?>;

public class GetProductByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetProductByIdQuery, ProductDto?>
{
    public async Task<ProductDto?> Handle(GetProductByIdQuery request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.ProductImage)
                .ThenInclude(pi => pi!.Image)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.Id, cancellationToken);

        if (product == null)
        {
            return null;
        }

        var imageUrl = product.ProductImage != null && product.ProductImage.Image != null
            ? product.ProductImage.Image.ImageUrl
            : null;

        imageUrl = UrlExtensions.ToAbsoluteUrl(httpContextAccessor, imageUrl);

        var priceHistory = await db.ProductPriceHistories
            .Include(h => h.UpdatedByNavigation)
            .Where(h => h.ProductId == request.Id)
            .OrderByDescending(h => h.UpdatedAt)
            .Select(h => new ProductPriceHistoryDto(
                h.Id,
                h.ProductId,
                h.OldPrice,
                h.NewPrice,
                h.UpdatedAt,
                h.UpdatedBy,
                $"{h.UpdatedByNavigation.FirstName} {h.UpdatedByNavigation.LastName}"
            ))
            .ToListAsync(cancellationToken);

        return ProductMapping.ToDto(product, imageUrl, priceHistory);
    }
}
