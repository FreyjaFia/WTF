using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Catalog;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Services;
using WTF.Calculations.Branding;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branding;

public record BrandDto(
    string ShopName,
    string? ShortName,
    string? Tagline,
    string? LogoUrl,
    string? Address,
    string? Phone,
    string? Email,
    string? ReceiptHeader,
    string? ReceiptFooter,
    string? RegistrationText,
    string PrimaryColor,
    bool SeniorPwdEnabled = false,
    bool VatRegistered = false);

// What the public customer page may know: the look and the contact lines, nothing about the shop's setup.
public record PublicBrandDto(
    string ShopName,
    string? ShortName,
    string? Tagline,
    string? LogoUrl,
    string? Address,
    string? Phone,
    string PrimaryColor);

public static class BrandDefaults
{
    public const string PrimaryColor = "#6f4e37";

    public static BrandDto For(string shopName) => new(shopName, null, null, null, null, null, null, null, null, null, PrimaryColor);

    public static BrandDto ToDto(TenantSetting s) => new(
        s.ShopName, s.ShortName, s.Tagline, s.LogoUrl, s.Address, s.Phone, s.Email, s.ReceiptHeader, s.ReceiptFooter,
        s.RegistrationText, s.PrimaryColor, s.SeniorPwdEnabled, s.VatRegistered);

    public static BrandDto WithAbsoluteLogo(BrandDto brand, IHttpContextAccessor http) =>
        brand with { LogoUrl = UrlExtensions.ToAbsoluteUrl(http, brand.LogoUrl) };

    public static PublicBrandDto ToPublic(BrandDto b) => new(
        b.ShopName, b.ShortName, b.Tagline, b.LogoUrl, b.Address, b.Phone, b.PrimaryColor);

    public static async Task<BrandDto> LoadAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var settings = await db.TenantSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (settings is not null)
        {
            return ToDto(settings);
        }

        var name = await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken);
        return For(name ?? "WTF");
    }

    public static void Validate(BrandDto brand)
    {
        var name = brand.ShopName?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 100)
        {
            throw new InvalidOperationException("Shop name is required (100 characters at most).");
        }

        CheckLength(brand.ShortName, 30, "Short name");
        CheckLength(brand.Tagline, 150, "Tagline");
        CheckLength(brand.Address, 300, "Address");
        CheckLength(brand.Phone, 40, "Phone");
        CheckLength(brand.Email, 150, "Email");
        CheckLength(brand.ReceiptHeader, 300, "Receipt header");
        CheckLength(brand.ReceiptFooter, 300, "Receipt footer");
        CheckLength(brand.RegistrationText, 150, "Registration text");

        if (!ColorRules.TryParseHex(brand.PrimaryColor, out _))
        {
            throw new InvalidOperationException("Colour must look like #6f4e37.");
        }

        if (!ColorRules.IsReadableWithWhiteText(brand.PrimaryColor))
        {
            throw new InvalidOperationException("That colour is too light for white text. Pick a darker one.");
        }
    }

    public static async Task<TenantSetting> EnsureSettingsAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken)
    {
        var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        var name = await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken);
        settings = new TenantSetting
        {
            TenantId = tenantId,
            ShopName = name ?? "WTF",
            PrimaryColor = PrimaryColor,
            TimeZone = "Asia/Manila",
            CurrencySymbol = "\u20B1",
            CurrencyCode = "PHP",
            CurrencyDecimals = 2,
        };
        db.TenantSettings.Add(settings);
        return settings;
    }

    public static async Task SaveAsync(
        WTFDbContext db, Guid tenantId, BrandDto brand, CancellationToken cancellationToken, bool saveTaxSettings = false, Guid? changedBy = null)
    {
        Validate(brand);

        var settings = await EnsureSettingsAsync(db, tenantId, cancellationToken);

        settings.ShopName = brand.ShopName.Trim();
        settings.ShortName = Clean(brand.ShortName);
        settings.Tagline = Clean(brand.Tagline);
        settings.Address = Clean(brand.Address);
        settings.Phone = Clean(brand.Phone);
        settings.Email = Clean(brand.Email);
        settings.ReceiptHeader = Clean(brand.ReceiptHeader);
        settings.ReceiptFooter = Clean(brand.ReceiptFooter);
        settings.RegistrationText = Clean(brand.RegistrationText);
        settings.PrimaryColor = brand.PrimaryColor.ToLowerInvariant();
        if (saveTaxSettings)
        {
            settings.SeniorPwdEnabled = brand.SeniorPwdEnabled;
            settings.VatRegistered = brand.VatRegistered;
        }

        settings.UpdatedAt = DateTime.UtcNow;
        CatalogChangeRecorder.RecordTenantSettings(db, settings, changedBy);

        await db.SaveChangesAsync(cancellationToken);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void CheckLength(string? value, int max, string label)
    {
        if (value is not null && value.Trim().Length > max)
        {
            throw new InvalidOperationException($"{label} is too long ({max} characters at most).");
        }
    }
}

public record GetBrandQuery : IRequest<BrandDto>;

public class GetBrandHandler(WTFDbContext db, ICurrentTenant currentTenant, IHttpContextAccessor http) : IRequestHandler<GetBrandQuery, BrandDto>
{
    public async Task<BrandDto> Handle(GetBrandQuery request, CancellationToken cancellationToken)
    {
        var brand = currentTenant.StampTenantId is { } tenantId
            ? await BrandDefaults.LoadAsync(db, tenantId, cancellationToken)
            : BrandDefaults.For("WTF");
        return BrandDefaults.WithAbsoluteLogo(brand, http);
    }
}

public record UpdateBrandCommand(BrandDto Brand) : IRequest<BrandDto>;

public class UpdateBrandHandler(WTFDbContext db, ICurrentTenant currentTenant, Services.IAuditService audit, IHttpContextAccessor http) : IRequestHandler<UpdateBrandCommand, BrandDto>
{
    public async Task<BrandDto> Handle(UpdateBrandCommand request, CancellationToken cancellationToken)
    {
        var tenantId = currentTenant.StampTenantId ?? throw new InvalidOperationException("Sign in to a shop first.");
        var before = await BrandDefaults.LoadAsync(db, tenantId, cancellationToken);

        Guid? changedBy = Guid.TryParse(http.HttpContext?.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var userId) ? userId : null;
        await BrandDefaults.SaveAsync(db, tenantId, request.Brand, cancellationToken, saveTaxSettings: true, changedBy: changedBy);

        var after = await BrandDefaults.LoadAsync(db, tenantId, cancellationToken);
        await audit.LogAsync(
            Audit.Enums.AuditAction.ShopBrandUpdated,
            Audit.Enums.AuditEntityType.Shop,
            tenantId.ToString(),
            oldValues: before,
            newValues: after,
            cancellationToken: cancellationToken);

        return BrandDefaults.WithAbsoluteLogo(after, http);
    }
}

public record GetPublicBrandQuery(string Token) : IRequest<PublicBrandDto?>;

public class GetPublicBrandHandler(WTFDbContext db, IHttpContextAccessor http) : IRequestHandler<GetPublicBrandQuery, PublicBrandDto?>
{
    public async Task<PublicBrandDto?> Handle(GetPublicBrandQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        if (access is null)
        {
            return null;
        }

        return BrandDefaults.ToPublic(BrandDefaults.WithAbsoluteLogo(await BrandDefaults.LoadAsync(db, access.Link.TenantId, cancellationToken), http));
    }
}

public record UploadBrandLogoCommand(byte[] ImageData) : IRequest<BrandDto>;

public class UploadBrandLogoHandler(WTFDbContext db, ICurrentTenant currentTenant, IImageStorage imageStorage, IAuditService audit, IHttpContextAccessor http)
    : IRequestHandler<UploadBrandLogoCommand, BrandDto>
{
    public async Task<BrandDto> Handle(UploadBrandLogoCommand request, CancellationToken cancellationToken)
    {
        var tenantId = currentTenant.StampTenantId ?? throw new InvalidOperationException("Sign in to a shop first.");
        var processed = ImageUploads.Prepare(request.ImageData);

        var settings = await BrandDefaults.EnsureSettingsAsync(db, tenantId, cancellationToken);
        var oldUrl = settings.LogoUrl;

        settings.LogoUrl = await imageStorage.SaveAsync("brand", $"logo_{Guid.NewGuid():N}{processed.Extension}", processed.Data, cancellationToken);
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(oldUrl))
        {
            await imageStorage.DeleteAsync(oldUrl, cancellationToken);
        }

        await audit.LogAsync(Audit.Enums.AuditAction.ShopBrandUpdated, Audit.Enums.AuditEntityType.Shop, tenantId.ToString(), oldValues: null, newValues: new { Logo = "changed" }, cancellationToken: cancellationToken);

        return BrandDefaults.WithAbsoluteLogo(await BrandDefaults.LoadAsync(db, tenantId, cancellationToken), http);
    }
}

public record RemoveBrandLogoCommand : IRequest<BrandDto>;

public class RemoveBrandLogoHandler(WTFDbContext db, ICurrentTenant currentTenant, IImageStorage imageStorage, IAuditService audit, IHttpContextAccessor http)
    : IRequestHandler<RemoveBrandLogoCommand, BrandDto>
{
    public async Task<BrandDto> Handle(RemoveBrandLogoCommand request, CancellationToken cancellationToken)
    {
        var tenantId = currentTenant.StampTenantId ?? throw new InvalidOperationException("Sign in to a shop first.");
        var settings = await BrandDefaults.EnsureSettingsAsync(db, tenantId, cancellationToken);
        var oldUrl = settings.LogoUrl;

        settings.LogoUrl = null;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(oldUrl))
        {
            await imageStorage.DeleteAsync(oldUrl, cancellationToken);
            await audit.LogAsync(Audit.Enums.AuditAction.ShopBrandUpdated, Audit.Enums.AuditEntityType.Shop, tenantId.ToString(), oldValues: new { Logo = "set" }, newValues: new { Logo = "removed" }, cancellationToken: cancellationToken);
        }

        return BrandDefaults.WithAbsoluteLogo(await BrandDefaults.LoadAsync(db, tenantId, cancellationToken), http);
    }
}
