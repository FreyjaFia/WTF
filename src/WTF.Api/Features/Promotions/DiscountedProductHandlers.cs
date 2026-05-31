using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

public record GetDiscountedProductPromotionsQuery : IRequest<List<PromotionListItemDto>>;

public sealed class GetDiscountedProductPromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetDiscountedProductPromotionsQuery, List<PromotionListItemDto>>
{
    public async Task<List<PromotionListItemDto>> Handle(GetDiscountedProductPromotionsQuery request, CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .Where(x => x.TypeId == PromotionTypeIds.DiscountedProduct)
            .Include(x => x.DiscountedProductPromotions)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.Name)
            .ToListAsync(cancellationToken);

        return [.. promotions.Select(x => new PromotionListItemDto(
            x.Id,
            x.Name,
            x.TypeId,
            x.IsActive,
            x.StartDate,
            x.EndDate,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, x.PromotionImage?.Image?.ImageUrl),
            null,
            x.DiscountedProductPromotions.FirstOrDefault()?.FixedPrice,
            x.DiscountedProductPromotions.FirstOrDefault()?.PercentOff,
            x.CreatedAt,
            x.CreatedBy,
            x.UpdatedAt,
            x.UpdatedBy))];
    }
}

public record GetActiveDiscountedProductPromotionsQuery(DateTime? EvaluatedAtUtc) : IRequest<List<DiscountedProductPromotionDto>>;

public sealed class GetActiveDiscountedProductPromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetActiveDiscountedProductPromotionsQuery, List<DiscountedProductPromotionDto>>
{
    public async Task<List<DiscountedProductPromotionDto>> Handle(GetActiveDiscountedProductPromotionsQuery request, CancellationToken cancellationToken)
    {
        var now = (request.EvaluatedAtUtc ?? DateTime.UtcNow).ToUniversalTime();
        var promotions = await db.Promotions
            .Where(x => x.TypeId == PromotionTypeIds.DiscountedProduct)
            .Where(x => x.IsActive)
            .Where(x => !x.StartDate.HasValue || x.StartDate <= now)
            .Where(x => !x.EndDate.HasValue || x.EndDate >= now)
            .Include(x => x.DiscountedProductPromotions)
                .ThenInclude(x => x.DiscountedProductPromotionAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        return [.. promotions
            .Where(x => x.DiscountedProductPromotions.Count > 0)
            .Select(x => DiscountedProductMapping.ToDto(x, httpContextAccessor))];
    }
}

public record GetDiscountedProductPromotionByIdQuery(Guid PromotionId) : IRequest<DiscountedProductPromotionDto?>;

public sealed class GetDiscountedProductPromotionByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetDiscountedProductPromotionByIdQuery, DiscountedProductPromotionDto?>
{
    public async Task<DiscountedProductPromotionDto?> Handle(GetDiscountedProductPromotionByIdQuery request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.DiscountedProduct)
            .Include(x => x.DiscountedProductPromotions)
                .ThenInclude(x => x.DiscountedProductPromotionAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        if (promo is null || promo.DiscountedProductPromotions.Count == 0)
        {
            return null;
        }

        return DiscountedProductMapping.ToDto(promo, httpContextAccessor);
    }
}

public record CreateDiscountedProductPromotionCommand : IRequest<DiscountedProductPromotionDto>
{
    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }

    [MinLength(1)]
    public List<CreateDiscountedProductItemRequestDto> Items { get; init; } = [];
}

public sealed record CreateDiscountedProductAddOnRequestDto(
    Guid AddOnProductId,
    int Quantity);

public sealed record CreateDiscountedProductItemRequestDto(
    Guid ProductId,
    decimal? FixedPrice,
    decimal? PercentOff,
    List<CreateDiscountedProductAddOnRequestDto> AddOns);

public sealed class CreateDiscountedProductPromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<CreateDiscountedProductPromotionCommand, DiscountedProductPromotionDto>
{
    public async Task<DiscountedProductPromotionDto> Handle(CreateDiscountedProductPromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        DiscountedProductValidation.EnsureValid(request.Name, request.StartDate, request.EndDate, request.Items);
        await DiscountedProductValidation.EnsureAddOnsAreLinkedAsync(db, request.Items, cancellationToken);

        var promo = new Promotion
        {
            Name = request.Name.Trim(),
            TypeId = PromotionTypeIds.DiscountedProduct,
            IsActive = request.IsActive,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        foreach (var item in request.Items ?? [])
        {
            var discounted = new DiscountedProductPromotion
            {
                Promotion = promo,
                ProductId = item.ProductId,
                FixedPrice = item.FixedPrice,
                PercentOff = item.PercentOff
            };

            foreach (var addOn in item.AddOns ?? [])
            {
                discounted.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn
                {
                    AddOnProductId = addOn.AddOnProductId,
                    Quantity = addOn.Quantity
                });
            }

            promo.DiscountedProductPromotions.Add(discounted);
        }
        db.Promotions.Add(promo);
        await db.SaveChangesAsync(cancellationToken);

        return DiscountedProductMapping.ToDto(promo, null);
    }
}

public record UpdateDiscountedProductPromotionCommand : IRequest<DiscountedProductPromotionDto?>
{
    [Required]
    public Guid PromotionId { get; init; }

    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }

    [MinLength(1)]
    public List<CreateDiscountedProductItemRequestDto> Items { get; init; } = [];
}

public sealed class UpdateDiscountedProductPromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<UpdateDiscountedProductPromotionCommand, DiscountedProductPromotionDto?>
{
    public async Task<DiscountedProductPromotionDto?> Handle(UpdateDiscountedProductPromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        DiscountedProductValidation.EnsureValid(request.Name, request.StartDate, request.EndDate, request.Items);
        await DiscountedProductValidation.EnsureAddOnsAreLinkedAsync(db, request.Items, cancellationToken);

        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.DiscountedProduct)
            .Include(x => x.DiscountedProductPromotions)
                .ThenInclude(x => x.DiscountedProductPromotionAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        if (promo is null)
        {
            return null;
        }

        promo.Name = request.Name.Trim();
        promo.IsActive = request.IsActive;
        promo.StartDate = request.StartDate;
        promo.EndDate = request.EndDate;
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = userId;

        db.DiscountedProductPromotionAddOns.RemoveRange(
            promo.DiscountedProductPromotions.SelectMany(x => x.DiscountedProductPromotionAddOns));
        db.DiscountedProductPromotions.RemoveRange(promo.DiscountedProductPromotions);
        promo.DiscountedProductPromotions.Clear();

        foreach (var item in request.Items ?? [])
        {
            var discounted = new DiscountedProductPromotion
            {
                PromotionId = promo.Id,
                ProductId = item.ProductId,
                FixedPrice = item.FixedPrice,
                PercentOff = item.PercentOff
            };

            foreach (var addOn in item.AddOns ?? [])
            {
                discounted.DiscountedProductPromotionAddOns.Add(new DiscountedProductPromotionAddOn
                {
                    AddOnProductId = addOn.AddOnProductId,
                    Quantity = addOn.Quantity
                });
            }

            promo.DiscountedProductPromotions.Add(discounted);
        }

        await db.SaveChangesAsync(cancellationToken);
        return DiscountedProductMapping.ToDto(promo, httpContextAccessor);
    }
}

public record DeleteDiscountedProductPromotionCommand(Guid PromotionId) : IRequest<bool>;

public sealed class DeleteDiscountedProductPromotionHandler(WTFDbContext db, IImageStorage imageStorage)
    : IRequestHandler<DeleteDiscountedProductPromotionCommand, bool>
{
    public async Task<bool> Handle(DeleteDiscountedProductPromotionCommand request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.DiscountedProduct, cancellationToken);

        if (promo is null)
        {
            return false;
        }

        if (promo.PromotionImage?.Image is not null)
        {
            await imageStorage.DeleteAsync(promo.PromotionImage.Image.ImageUrl, cancellationToken);
            db.PromotionImages.Remove(promo.PromotionImage);
            db.Images.Remove(promo.PromotionImage.Image);
        }

        db.Promotions.Remove(promo);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
