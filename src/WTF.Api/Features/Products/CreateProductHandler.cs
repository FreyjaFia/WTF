using MediatR;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Catalog;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Products.DTOs;
using WTF.Api.Services;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public record CreateProductCommand : IRequest<ProductDto>
{
    [Required(ErrorMessage = "Product name is required")]
    [StringLength(100, ErrorMessage = "Name cannot exceed 100 characters")]
    public string Name { get; init; } = string.Empty;

    [Required(ErrorMessage = "Product code is required")]
    [StringLength(10, ErrorMessage = "Code cannot exceed 10 characters")]
    public string Code { get; init; } = string.Empty;

    [StringLength(500, ErrorMessage = "Description cannot exceed 500 characters")]
    public string? Description { get; init; }

    [Required(ErrorMessage = "Price is required")]
    [Range(0, 999999.99, ErrorMessage = "Price must be between 0 and 999,999.99")]
    public decimal Price { get; init; }

    [Required(ErrorMessage = "Product category is required")]
    public int Category { get; init; }

    public bool IsAddOn { get; init; }

    public bool IsActive { get; init; } = true;

    public bool IsSeniorPwdEligible { get; init; } = true;

    public int? SubCategory { get; init; }

    public List<Guid>? SoldAtBranchIds { get; init; }
}

public class CreateProductHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor, IAuditService auditService, ITenantFeatures tenantFeatures) : IRequestHandler<CreateProductCommand, ProductDto>
{
    public async Task<ProductDto> Handle(CreateProductCommand request, CancellationToken cancellationToken)
    {
        var user = httpContextAccessor.HttpContext!.User;
        var userId = user.GetUserId();
        var soldAt = await ResolveSoldAtAsync(request.SoldAtBranchIds, user, cancellationToken);
        var normalizedCode = ProductValidation.NormalizeCode(request.Code);

        await ProductValidation.EnsureValidCategoryAsync(db, request.Category, request.SubCategory, null, null, cancellationToken);
        await ProductValidation.EnsureUniqueCodeAsync(db, normalizedCode, cancellationToken: cancellationToken);

        var product = new Product
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Code = normalizedCode,
            Description = request.Description,
            Price = request.Price,
            CategoryId = request.Category,
            SubCategoryId = request.SubCategory,
            IsAddOn = request.IsAddOn,
            IsActive = request.IsActive,
            IsSeniorPwdEligible = request.IsSeniorPwdEligible,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Products.Add(product);
        db.ProductBranches.AddRange(soldAt.Select(branchId => new ProductBranch
        {
            ProductId = product.Id,
            BranchId = branchId,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        }));
        CatalogChangeRecorder.RecordProduct(db, product, userId);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            action: AuditAction.ProductCreated,
            entityType: AuditEntityType.Product,
            entityId: product.Id.ToString(),
            newValues: new
            {
                product.Name,
                product.Code,
                product.Price,
                product.CategoryId,
                product.SubCategoryId,
                product.IsAddOn,
                product.IsActive,
                product.IsSeniorPwdEligible,
                SoldAtBranchIds = soldAt
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return ProductMapping.ToDto(product, null, new List<ProductPriceHistoryDto>(), soldAtBranchIds: soldAt);
    }

    // An empty answer means sold at every branch. A person limited to some branches always creates a branch product.
    private async Task<List<Guid>> ResolveSoldAtAsync(List<Guid>? requested, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var branchesOn = await tenantFeatures.HasFeatureAsync(db, PlanFeatures.Branches, cancellationToken);
        if (ProductWriteScope.IsShopWide(db, user))
        {
            var ids = branchesOn ? (requested ?? []).Distinct().ToList() : [];
            if (ids.Count > 0)
            {
                await ProductSoldAtRules.EnsureValidAsync(db, ids, cancellationToken);
            }

            return ids;
        }

        if (!ProductWriteScope.HasBranchKey(user))
        {
            throw new ForbiddenActionException(ProductWriteScope.NotYoursMessage);
        }

        var branchIds = requested is { Count: > 0 }
            ? requested.Distinct().ToList()
            : db.ActiveBranchId is { } active ? [active] : [];
        await ProductSoldAtRules.EnsureValidAsync(db, branchIds, cancellationToken);
        return branchIds;
    }
}
