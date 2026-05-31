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
            null,
            null,
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
