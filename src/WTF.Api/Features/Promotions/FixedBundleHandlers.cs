using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

public record GetFixedBundlePromotionsQuery : IRequest<List<PromotionListItemDto>>;

public sealed class GetFixedBundlePromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetFixedBundlePromotionsQuery, List<PromotionListItemDto>>
{
    public async Task<List<PromotionListItemDto>> Handle(GetFixedBundlePromotionsQuery request, CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .Where(x => x.TypeId == PromotionTypeIds.FixedBundle)
            .Include(x => x.FixedBundlePromotion)
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
                x.FixedBundlePromotion?.BundlePrice,
                x.CreatedAt,
                x.CreatedBy,
                x.UpdatedAt,
                x.UpdatedBy))];
    }
}

public record GetFixedBundlePromotionByIdQuery(Guid PromotionId) : IRequest<FixedBundlePromotionDto?>;

public sealed class GetFixedBundlePromotionByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetFixedBundlePromotionByIdQuery, FixedBundlePromotionDto?>
{
    public async Task<FixedBundlePromotionDto?> Handle(GetFixedBundlePromotionByIdQuery request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.FixedBundle)
            .Include(x => x.FixedBundlePromotion!)
                .ThenInclude(x => x.FixedBundlePromotionItems)
                    .ThenInclude(x => x.FixedBundlePromotionItemAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        if (promo?.FixedBundlePromotion is null)
        {
            return null;
        }

        return FixedBundleMapping.ToDto(promo, httpContextAccessor);
    }
}

public record CreateFixedBundlePromotionCommand : IRequest<FixedBundlePromotionDto>
{
    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }

    [Range(0, 999999.99)]
    public decimal BundlePrice { get; init; }

    [MinLength(1)]
    public List<CreateFixedBundlePromotionItemRequestDto> Items { get; init; } = [];
}

public sealed record CreateFixedBundlePromotionItemRequestDto(
    Guid ProductId,
    int Quantity,
    List<CreateFixedBundlePromotionItemAddOnRequestDto> AddOns);

public sealed record CreateFixedBundlePromotionItemAddOnRequestDto(
    Guid AddOnProductId,
    int Quantity);

public sealed class CreateFixedBundlePromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<CreateFixedBundlePromotionCommand, FixedBundlePromotionDto>
{
    public async Task<FixedBundlePromotionDto> Handle(CreateFixedBundlePromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        FixedBundleValidation.EnsureValid(request.Name, request.StartDate, request.EndDate, request.Items);
        await FixedBundleValidation.EnsureAddOnsAreLinkedToBundleItemsAsync(db, request.Items, cancellationToken);

        var promo = new Promotion
        {
            Name = request.Name.Trim(),
            TypeId = PromotionTypeIds.FixedBundle,
            IsActive = request.IsActive,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        var fixedBundle = new FixedBundlePromotion
        {
            Promotion = promo,
            BundlePrice = request.BundlePrice
        };

        foreach (var item in request.Items)
        {
            var bundleItem = new FixedBundlePromotionItem
            {
                ProductId = item.ProductId,
                Quantity = item.Quantity
            };

            foreach (var addOn in item.AddOns ?? [])
            {
                bundleItem.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn
                {
                    AddOnProductId = addOn.AddOnProductId,
                    Quantity = addOn.Quantity
                });
            }

            fixedBundle.FixedBundlePromotionItems.Add(bundleItem);
        }

        promo.FixedBundlePromotion = fixedBundle;
        db.Promotions.Add(promo);
        await db.SaveChangesAsync(cancellationToken);

        return FixedBundleMapping.ToDto(promo, null);
    }
}

public record UpdateFixedBundlePromotionCommand : IRequest<FixedBundlePromotionDto?>
{
    [Required]
    public Guid PromotionId { get; init; }

    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }

    [Range(0, 999999.99)]
    public decimal BundlePrice { get; init; }

    [MinLength(1)]
    public List<CreateFixedBundlePromotionItemRequestDto> Items { get; init; } = [];
}

public sealed class UpdateFixedBundlePromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<UpdateFixedBundlePromotionCommand, FixedBundlePromotionDto?>
{
    public async Task<FixedBundlePromotionDto?> Handle(UpdateFixedBundlePromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        FixedBundleValidation.EnsureValid(request.Name, request.StartDate, request.EndDate, request.Items);
        await FixedBundleValidation.EnsureAddOnsAreLinkedToBundleItemsAsync(db, request.Items, cancellationToken);

        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.FixedBundle)
            .Include(x => x.FixedBundlePromotion!)
                .ThenInclude(x => x.FixedBundlePromotionItems)
                    .ThenInclude(x => x.FixedBundlePromotionItemAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        if (promo?.FixedBundlePromotion is null)
        {
            return null;
        }

        promo.Name = request.Name.Trim();
        promo.IsActive = request.IsActive;
        promo.StartDate = request.StartDate;
        promo.EndDate = request.EndDate;
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = userId;
        promo.FixedBundlePromotion.BundlePrice = request.BundlePrice;

        db.FixedBundlePromotionItemAddOns.RemoveRange(
            promo.FixedBundlePromotion.FixedBundlePromotionItems.SelectMany(x => x.FixedBundlePromotionItemAddOns));
        db.FixedBundlePromotionItems.RemoveRange(promo.FixedBundlePromotion.FixedBundlePromotionItems);

        promo.FixedBundlePromotion.FixedBundlePromotionItems.Clear();

        foreach (var item in request.Items)
        {
            var bundleItem = new FixedBundlePromotionItem
            {
                ProductId = item.ProductId,
                Quantity = item.Quantity
            };

            foreach (var addOn in item.AddOns ?? [])
            {
                bundleItem.FixedBundlePromotionItemAddOns.Add(new FixedBundlePromotionItemAddOn
                {
                    AddOnProductId = addOn.AddOnProductId,
                    Quantity = addOn.Quantity
                });
            }

            promo.FixedBundlePromotion.FixedBundlePromotionItems.Add(bundleItem);
        }

        await db.SaveChangesAsync(cancellationToken);
        return FixedBundleMapping.ToDto(promo, httpContextAccessor);
    }
}

public record DeleteFixedBundlePromotionCommand(Guid PromotionId) : IRequest<bool>;

public sealed class DeleteFixedBundlePromotionHandler(WTFDbContext db, IImageStorage imageStorage)
    : IRequestHandler<DeleteFixedBundlePromotionCommand, bool>
{
    public async Task<bool> Handle(DeleteFixedBundlePromotionCommand request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.FixedBundle, cancellationToken);

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

internal static class FixedBundleValidation
{
    public static void EnsureValid(
        string name,
        DateTime? startAtUtc,
        DateTime? endAtUtc,
        List<CreateFixedBundlePromotionItemRequestDto> items)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Promotion name is required.");
        }

        if (endAtUtc.HasValue && startAtUtc.HasValue && endAtUtc.Value < startAtUtc.Value)
        {
            throw new InvalidOperationException("End date cannot be earlier than start date.");
        }

        if (items.Count == 0)
        {
            throw new InvalidOperationException("At least one bundle item is required.");
        }

        foreach (var item in items)
        {
            if (item.Quantity <= 0)
            {
                throw new InvalidOperationException("Bundle item quantity must be greater than zero.");
            }

            foreach (var addOn in item.AddOns ?? [])
            {
                if (addOn.Quantity <= 0)
                {
                    throw new InvalidOperationException("Bundle add-on quantity must be greater than zero.");
                }
            }
        }
    }

    public static async Task EnsureAddOnsAreLinkedToBundleItemsAsync(
        WTFDbContext db,
        List<CreateFixedBundlePromotionItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        var pairs = items
            .SelectMany(item => (item.AddOns ?? []).Select(addOn => new { item.ProductId, addOn.AddOnProductId }))
            .Distinct()
            .ToList();

        if (pairs.Count == 0)
        {
            return;
        }

        var productIds = pairs.Select(x => x.ProductId).Distinct().ToList();
        var addOnIds = pairs.Select(x => x.AddOnProductId).Distinct().ToList();
        var allowed = await db.ProductAddOns
            .Where(x => productIds.Contains(x.ProductId) && addOnIds.Contains(x.AddOnId))
            .Select(x => new { x.ProductId, x.AddOnId })
            .ToListAsync(cancellationToken);

        var allowedSet = allowed
            .Select(x => $"{x.ProductId}:{x.AddOnId}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var invalid = pairs
            .FirstOrDefault(x => !allowedSet.Contains($"{x.ProductId}:{x.AddOnProductId}"));

        if (invalid is not null)
        {
            throw new InvalidOperationException("One or more bundle add-ons are not linked to their parent product.");
        }
    }
}

internal static class FixedBundleMapping
{
    public static FixedBundlePromotionDto ToDto(Promotion promo, IHttpContextAccessor? httpContextAccessor)
    {
        var fixedBundle = promo.FixedBundlePromotion!;
        return new FixedBundlePromotionDto(
            promo.Id,
            promo.Name,
            promo.IsActive,
            promo.StartDate,
            promo.EndDate,
            UrlExtensions.ToAbsoluteUrl(httpContextAccessor, promo.PromotionImage?.Image?.ImageUrl),
            promo.CreatedAt,
            promo.CreatedBy,
            promo.UpdatedAt,
            promo.UpdatedBy,
            fixedBundle.BundlePrice,
            [.. fixedBundle.FixedBundlePromotionItems
                .OrderBy(x => x.ProductId)
                .Select(item => new FixedBundleItemDto(
                    item.Id,
                    item.ProductId,
                    item.Quantity,
                    [.. item.FixedBundlePromotionItemAddOns
                        .OrderBy(x => x.AddOnProductId)
                        .Select(addOn => new FixedBundleItemAddOnDto(
                            addOn.Id,
                            addOn.AddOnProductId,
                            addOn.Quantity))]))]);
    }
}
