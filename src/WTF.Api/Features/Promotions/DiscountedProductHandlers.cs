using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Calculations.Orders;
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

        var used = await PromotionUsage.CountAsync(db, [.. promotions.Select(x => x.Id)], null, cancellationToken);

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
            x.UpdatedBy,
            PromotionScheduleMapping.ToDto(x, used[x.Id])))];
    }
}

// All = every active promotion whatever the date, weekday or hour, for the POS to keep offline and judge itself.
public record GetActiveDiscountedProductPromotionsQuery(DateTime? EvaluatedAtUtc, bool All = false)
    : IRequest<List<DiscountedProductPromotionDto>>;

public sealed class GetActiveDiscountedProductPromotionsHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetActiveDiscountedProductPromotionsQuery, List<DiscountedProductPromotionDto>>
{
    public async Task<List<DiscountedProductPromotionDto>> Handle(GetActiveDiscountedProductPromotionsQuery request, CancellationToken cancellationToken)
    {
        var now = (request.EvaluatedAtUtc ?? DateTime.UtcNow).ToUniversalTime();
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var scheduled = await db.Promotions
            .Where(x => x.TypeId == PromotionTypeIds.DiscountedProduct)
            .Where(x => x.IsActive)
            .Include(x => x.DiscountedProductPromotions)
                .ThenInclude(x => x.DiscountedProductPromotionAddOns)
            .Include(x => x.PromotionImage!)
                .ThenInclude(x => x.Image)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        // Same rule the order is saved with: dates, weekdays and hours are the shop's local time.
        var promotions = (request.All
                ? scheduled
                : scheduled.Where(x => PromotionPricing.IsPromotionActiveOnLocalDate(x, now, timeZone)))
            .Where(x => x.DiscountedProductPromotions.Count > 0)
            .ToList();

        var used = await PromotionUsage.CountAsync(db, [.. promotions.Select(x => x.Id)], null, cancellationToken);

        return [.. promotions.Select(x => DiscountedProductMapping.ToDto(x, httpContextAccessor, used[x.Id]))];
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

        var used = (await PromotionUsage.CountAsync(db, [promo.Id], null, cancellationToken))[promo.Id];
        return DiscountedProductMapping.ToDto(promo, httpContextAccessor, used);
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
    public PromotionScheduleRequest? Schedule { get; init; }

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
        PromotionScheduleMapping.EnsureValid(request.Schedule);
        await PromotionProductValidation.EnsureUsableAsync(
            db,
            request.Items.Select(i => i.ProductId),
            request.Items.SelectMany(i => (i.AddOns ?? []).Select(a => a.AddOnProductId)),
            request.IsActive,
            cancellationToken);
        await DiscountedProductValidation.EnsureAddOnsAreLinkedAsync(db, request.Items, cancellationToken);
        await PromotionAddOnRules.EnsureRequiredTypesAsync(
            db,
            [.. request.Items.Select(i => (i.ProductId, (IReadOnlyCollection<Guid>)[.. (i.AddOns ?? []).Select(a => a.AddOnProductId)]))],
            cancellationToken);

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
        PromotionScheduleMapping.Apply(promo, request.Schedule);

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
    public PromotionScheduleRequest? Schedule { get; init; }

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
        PromotionScheduleMapping.EnsureValid(request.Schedule);
        await PromotionProductValidation.EnsureUsableAsync(
            db,
            request.Items.Select(i => i.ProductId),
            request.Items.SelectMany(i => (i.AddOns ?? []).Select(a => a.AddOnProductId)),
            request.IsActive,
            cancellationToken);
        await DiscountedProductValidation.EnsureAddOnsAreLinkedAsync(db, request.Items, cancellationToken);
        await PromotionAddOnRules.EnsureRequiredTypesAsync(
            db,
            [.. request.Items.Select(i => (i.ProductId, (IReadOnlyCollection<Guid>)[.. (i.AddOns ?? []).Select(a => a.AddOnProductId)]))],
            cancellationToken);

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
        PromotionScheduleMapping.Apply(promo, request.Schedule);

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
        var used = (await PromotionUsage.CountAsync(db, [promo.Id], null, cancellationToken))[promo.Id];
        return DiscountedProductMapping.ToDto(promo, httpContextAccessor, used);
    }
}

public record DeleteDiscountedProductPromotionCommand(Guid PromotionId) : IRequest<bool>;

public sealed class DeleteDiscountedProductPromotionHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<DeleteDiscountedProductPromotionCommand, bool>
{
    public async Task<bool> Handle(DeleteDiscountedProductPromotionCommand request, CancellationToken cancellationToken)
    {
        var promo = await db.Promotions
            .FirstOrDefaultAsync(x => x.Id == request.PromotionId && x.TypeId == PromotionTypeIds.DiscountedProduct, cancellationToken);

        if (promo is null)
        {
            return false;
        }

        // Soft delete - keep the promotion, its image, and its rules so it can be restored
        promo.IsActive = false;
        promo.UpdatedAt = DateTime.UtcNow;
        promo.UpdatedBy = httpContextAccessor.HttpContext!.User.GetUserId();

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
