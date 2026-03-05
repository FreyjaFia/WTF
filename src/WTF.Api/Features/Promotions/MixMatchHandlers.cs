using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

public record GetMixMatchPromotionsQuery : IRequest<List<PromotionListItemDto>>;

public sealed class GetMixMatchPromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetMixMatchPromotionsQuery, List<PromotionListItemDto>>
{
    public async Task<List<PromotionListItemDto>> Handle(GetMixMatchPromotionsQuery request, CancellationToken cancellationToken)
    {
        var promotions = await db.Promotions
            .Where(x => x.TypeId == PromotionTypeIds.MixMatch)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .Include(x => x.MixMatchPromotion)
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
            x.MixMatchPromotion?.BundlePrice,
            x.CreatedAt,
            x.CreatedBy,
            x.UpdatedAt,
            x.UpdatedBy))];
    }
}

public record GetMixMatchPromotionByIdQuery(Guid PromotionId) : IRequest<MixMatchPromotionDto?>;

public sealed class GetMixMatchPromotionByIdHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetMixMatchPromotionByIdQuery, MixMatchPromotionDto?>
{
    public async Task<MixMatchPromotionDto?> Handle(GetMixMatchPromotionByIdQuery request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.MixMatch)
            .Include(x => x.MixMatchPromotion!)
                .ThenInclude(x => x.MixMatchPromotionProducts)
                    .ThenInclude(x => x.MixMatchPromotionProductAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        return promo?.MixMatchPromotion is null
            ? null
            : MixMatchMapping.ToDto(promo, httpContextAccessor);
    }
}

public sealed record CreateMixMatchItemAddOnRequestDto(Guid AddOnProductId, int Quantity);
public sealed record CreateMixMatchItemRequestDto(Guid ProductId, List<CreateMixMatchItemAddOnRequestDto> AddOns);

public record CreateMixMatchPromotionCommand : IRequest<MixMatchPromotionDto>
{
    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public int RequiredQuantity { get; init; }
    public int? MaxSelectionsPerOrder { get; init; }
    public decimal BundlePrice { get; init; }
    public List<CreateMixMatchItemRequestDto> Items { get; init; } = [];
}

public sealed class CreateMixMatchPromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<CreateMixMatchPromotionCommand, MixMatchPromotionDto>
{
    public async Task<MixMatchPromotionDto> Handle(CreateMixMatchPromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        MixMatchValidation.EnsureValid(request);
        await MixMatchValidation.EnsureItemsAreLinkedAsync(db, request.Items, cancellationToken);

        var promo = new Promotion
        {
            Name = request.Name.Trim(),
            TypeId = PromotionTypeIds.MixMatch,
            IsActive = request.IsActive,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            MixMatchPromotion = MixMatchMapping.BuildMixMatch(request)
        };

        db.Promotions.Add(promo);
        await db.SaveChangesAsync(cancellationToken);

        return MixMatchMapping.ToDto(promo, null);
    }
}

public record UpdateMixMatchPromotionCommand : IRequest<MixMatchPromotionDto?>
{
    [Required]
    public Guid PromotionId { get; init; }

    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; } = true;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public int RequiredQuantity { get; init; }
    public int? MaxSelectionsPerOrder { get; init; }
    public decimal BundlePrice { get; init; }
    public List<CreateMixMatchItemRequestDto> Items { get; init; } = [];
}

public sealed class UpdateMixMatchPromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<UpdateMixMatchPromotionCommand, MixMatchPromotionDto?>
{
    public async Task<MixMatchPromotionDto?> Handle(UpdateMixMatchPromotionCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        MixMatchValidation.EnsureValid(request);
        await MixMatchValidation.EnsureItemsAreLinkedAsync(db, request.Items, cancellationToken);

        var promo = await db.Promotions
            .Where(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.MixMatch)
            .Include(x => x.MixMatchPromotion!)
                .ThenInclude(x => x.MixMatchPromotionProducts)
                    .ThenInclude(x => x.MixMatchPromotionProductAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(cancellationToken);

        if (promo?.MixMatchPromotion is null)
        {
            return null;
        }

        promo.Name = request.Name.Trim();
        promo.IsActive = request.IsActive;
        promo.StartDate = request.StartDate;
        promo.EndDate = request.EndDate;
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = userId;

        db.MixMatchPromotionProductAddOns.RemoveRange(
            promo.MixMatchPromotion.MixMatchPromotionProducts.SelectMany(x => x.MixMatchPromotionProductAddOns));
        db.MixMatchPromotionProducts.RemoveRange(promo.MixMatchPromotion.MixMatchPromotionProducts);

        promo.MixMatchPromotion.RequiredQuantity = request.RequiredQuantity;
        promo.MixMatchPromotion.MaxSelectionsPerOrder = request.MaxSelectionsPerOrder;
        promo.MixMatchPromotion.BundlePrice = request.BundlePrice;
        promo.MixMatchPromotion.MixMatchPromotionProducts.Clear();

        foreach (var product in MixMatchMapping.BuildMixMatchProducts(request.Items))
        {
            promo.MixMatchPromotion.MixMatchPromotionProducts.Add(product);
        }

        await db.SaveChangesAsync(cancellationToken);
        return MixMatchMapping.ToDto(promo, httpContextAccessor);
    }
}

public record DeleteMixMatchPromotionCommand(Guid PromotionId) : IRequest<bool>;

public sealed class DeleteMixMatchPromotionHandler(WTFDbContext db, IImageStorage imageStorage)
    : IRequestHandler<DeleteMixMatchPromotionCommand, bool>
{
    public async Task<bool> Handle(DeleteMixMatchPromotionCommand request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.MixMatch, cancellationToken);

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

internal static class MixMatchValidation
{
    public static void EnsureValid(CreateMixMatchPromotionCommand request)
    {
        EnsureValidCore(
            request.Name,
            request.StartDate,
            request.EndDate,
            request.RequiredQuantity,
            request.MaxSelectionsPerOrder,
            request.BundlePrice,
            request.Items);
    }

    public static void EnsureValid(UpdateMixMatchPromotionCommand request)
    {
        EnsureValidCore(
            request.Name,
            request.StartDate,
            request.EndDate,
            request.RequiredQuantity,
            request.MaxSelectionsPerOrder,
            request.BundlePrice,
            request.Items);
    }

    private static void EnsureValidCore(
        string name,
        DateTime? startDate,
        DateTime? endDate,
        int requiredQuantity,
        int? maxSelectionsPerOrder,
        decimal bundlePrice,
        List<CreateMixMatchItemRequestDto> items)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Promotion name is required.");
        }

        if (endDate.HasValue && startDate.HasValue && endDate.Value < startDate.Value)
        {
            throw new InvalidOperationException("End date cannot be earlier than start date.");
        }

        if (requiredQuantity <= 0)
        {
            throw new InvalidOperationException("Required quantity must be greater than zero.");
        }

        if (maxSelectionsPerOrder.HasValue && maxSelectionsPerOrder.Value <= 0)
        {
            throw new InvalidOperationException("Max selections per order must be greater than zero.");
        }

        if (bundlePrice < 0)
        {
            throw new InvalidOperationException("Bundle price must be greater than or equal to zero.");
        }

        if (items.Count == 0)
        {
            throw new InvalidOperationException("At least one product is required.");
        }

        if (items.Select(x => x.ProductId).Distinct().Count() != items.Count)
        {
            throw new InvalidOperationException("Duplicate products are not allowed.");
        }

        if (items.Any(item => item.AddOns.Any(addOn => addOn.Quantity <= 0)))
        {
            throw new InvalidOperationException("Add-on quantity must be greater than zero.");
        }
    }

    public static async Task EnsureItemsAreLinkedAsync(
        WTFDbContext db,
        List<CreateMixMatchItemRequestDto> items,
        CancellationToken cancellationToken)
    {
        foreach (var item in items)
        {
            await EnsureLinkedForSingleProductAsync(
                db,
                item.ProductId,
                [.. item.AddOns.Select(x => x.AddOnProductId)],
                cancellationToken);
        }
    }

    private static async Task EnsureLinkedForSingleProductAsync(
        WTFDbContext db,
        Guid productId,
        List<Guid> addOnIds,
        CancellationToken cancellationToken)
    {
        if (addOnIds.Count == 0)
        {
            return;
        }

        var uniqueIds = addOnIds.Distinct().ToList();
        var allowed = await db.ProductAddOns
            .Where(x => x.ProductId == productId && uniqueIds.Contains(x.AddOnId))
            .Select(x => x.AddOnId)
            .ToListAsync(cancellationToken);

        var allowedSet = allowed.ToHashSet();
        if (uniqueIds.Any(x => !allowedSet.Contains(x)))
        {
            throw new InvalidOperationException("One or more add-ons are not linked to the selected product.");
        }
    }
}

internal static class MixMatchMapping
{
    public static MixMatchPromotionDto ToDto(Promotion promo, IHttpContextAccessor? httpContextAccessor)
    {
        var mixMatch = promo.MixMatchPromotion!;
        return new MixMatchPromotionDto(
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
            mixMatch.RequiredQuantity,
            mixMatch.MaxSelectionsPerOrder,
            mixMatch.BundlePrice,
            [.. mixMatch.MixMatchPromotionProducts
                .OrderBy(x => x.Id)
                .Select(item => new MixMatchItemDto(
                    item.Id,
                    item.ProductId,
                    [.. item.MixMatchPromotionProductAddOns
                        .OrderBy(x => x.AddOnProductId)
                        .Select(addOn => new MixMatchItemAddOnDto(
                            addOn.Id,
                            addOn.AddOnProductId,
                            addOn.Quantity))]))]);
    }

    public static MixMatchPromotion BuildMixMatch(CreateMixMatchPromotionCommand request)
    {
        return new MixMatchPromotion
        {
            RequiredQuantity = request.RequiredQuantity,
            MaxSelectionsPerOrder = request.MaxSelectionsPerOrder,
            BundlePrice = request.BundlePrice,
            MixMatchPromotionProducts = BuildMixMatchProducts(request.Items)
        };
    }

    public static List<MixMatchPromotionProduct> BuildMixMatchProducts(List<CreateMixMatchItemRequestDto> items)
    {
        return [.. items.Select(item => new MixMatchPromotionProduct
        {
            ProductId = item.ProductId,
            MixMatchPromotionProductAddOns = [.. item.AddOns.Select(addOn => new MixMatchPromotionProductAddOn
            {
                AddOnProductId = addOn.AddOnProductId,
                Quantity = addOn.Quantity
            })]
        })];
    }
}
