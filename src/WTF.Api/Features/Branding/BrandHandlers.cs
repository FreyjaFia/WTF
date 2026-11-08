using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Features.OrderLinks;
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
    string TimeZone,
    string CurrencySymbol,
    string CurrencyCode,
    int CurrencyDecimals);

// What the public customer page may know: the look and the contact lines, nothing about the shop's setup.
public record PublicBrandDto(
    string ShopName,
    string? ShortName,
    string? Tagline,
    string? LogoUrl,
    string? Address,
    string? Phone,
    string PrimaryColor,
    string CurrencySymbol,
    int CurrencyDecimals);

public static partial class BrandDefaults
{
    public const string PrimaryColor = "#6f4e37";

    public const string TimeZone = "Asia/Manila";

    public const string CurrencySymbol = "₱";

    public const string CurrencyCode = "PHP";

    public static BrandDto For(string shopName) => new(shopName, null, null, null, null, null, null, null, null, null, PrimaryColor, TimeZone, CurrencySymbol, CurrencyCode, 2);

    public static BrandDto ToDto(TenantSettings s) => new(
        s.ShopName, s.ShortName, s.Tagline, s.LogoUrl, s.Address, s.Phone, s.Email, s.ReceiptHeader, s.ReceiptFooter,
        s.RegistrationText, s.PrimaryColor, s.TimeZone, s.CurrencySymbol, s.CurrencyCode, s.CurrencyDecimals);

    public static PublicBrandDto ToPublic(BrandDto b) => new(
        b.ShopName, b.ShortName, b.Tagline, b.LogoUrl, b.Address, b.Phone, b.PrimaryColor, b.CurrencySymbol, b.CurrencyDecimals);

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

        if (!string.IsNullOrWhiteSpace(brand.LogoUrl)
            && (brand.LogoUrl.Length > 500 || !(brand.LogoUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || brand.LogoUrl.StartsWith('/'))))
        {
            throw new InvalidOperationException("Logo must be an https address or a path on this site (500 characters at most).");
        }

        if (!ColorRules.TryParseHex(brand.PrimaryColor, out _))
        {
            throw new InvalidOperationException("Colour must look like #6f4e37.");
        }

        if (!ColorRules.IsReadableWithWhiteText(brand.PrimaryColor))
        {
            throw new InvalidOperationException("That colour is too light for white text. Pick a darker one.");
        }

        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(brand.TimeZone ?? string.Empty);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            throw new InvalidOperationException("Time zone is not recognised.");
        }

        if (brand.CurrencySymbol is not { Length: > 0 and <= 8 })
        {
            throw new InvalidOperationException("Currency symbol is required (8 characters at most).");
        }

        if (brand.CurrencyCode is null || !CurrencyCodePattern().IsMatch(brand.CurrencyCode))
        {
            throw new InvalidOperationException("Currency code must be three capital letters, for example PHP.");
        }

        if (brand.CurrencyDecimals is < 0 or > 3)
        {
            throw new InvalidOperationException("Currency decimals must be 0 to 3.");
        }
    }

    public static async Task SaveAsync(WTFDbContext db, Guid tenantId, BrandDto brand, CancellationToken cancellationToken)
    {
        Validate(brand);

        var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, cancellationToken);
        if (settings is null)
        {
            settings = new TenantSettings { TenantId = tenantId };
            db.TenantSettings.Add(settings);
        }

        settings.ShopName = brand.ShopName.Trim();
        settings.ShortName = Clean(brand.ShortName);
        settings.Tagline = Clean(brand.Tagline);
        settings.LogoUrl = Clean(brand.LogoUrl);
        settings.Address = Clean(brand.Address);
        settings.Phone = Clean(brand.Phone);
        settings.Email = Clean(brand.Email);
        settings.ReceiptHeader = Clean(brand.ReceiptHeader);
        settings.ReceiptFooter = Clean(brand.ReceiptFooter);
        settings.RegistrationText = Clean(brand.RegistrationText);
        settings.PrimaryColor = brand.PrimaryColor.ToLowerInvariant();
        settings.TimeZone = brand.TimeZone;
        settings.CurrencySymbol = brand.CurrencySymbol;
        settings.CurrencyCode = brand.CurrencyCode;
        settings.CurrencyDecimals = brand.CurrencyDecimals;
        settings.UpdatedAt = DateTime.UtcNow;

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

    [GeneratedRegex("^[A-Z]{3}$")]
    private static partial Regex CurrencyCodePattern();
}

public record GetBrandQuery : IRequest<BrandDto>;

public class GetBrandHandler(WTFDbContext db, ICurrentTenant currentTenant) : IRequestHandler<GetBrandQuery, BrandDto>
{
    public async Task<BrandDto> Handle(GetBrandQuery request, CancellationToken cancellationToken)
    {
        return currentTenant.StampTenantId is { } tenantId
            ? await BrandDefaults.LoadAsync(db, tenantId, cancellationToken)
            : BrandDefaults.For("WTF");
    }
}

public record UpdateBrandCommand(BrandDto Brand) : IRequest<BrandDto>;

public class UpdateBrandHandler(WTFDbContext db, ICurrentTenant currentTenant, Services.IAuditService audit) : IRequestHandler<UpdateBrandCommand, BrandDto>
{
    public async Task<BrandDto> Handle(UpdateBrandCommand request, CancellationToken cancellationToken)
    {
        var tenantId = currentTenant.StampTenantId ?? throw new InvalidOperationException("Sign in to a shop first.");
        var before = await BrandDefaults.LoadAsync(db, tenantId, cancellationToken);

        await BrandDefaults.SaveAsync(db, tenantId, request.Brand, cancellationToken);

        var after = await BrandDefaults.LoadAsync(db, tenantId, cancellationToken);
        await audit.LogAsync(
            Audit.Enums.AuditAction.ShopBrandUpdated,
            Audit.Enums.AuditEntityType.Shop,
            tenantId.ToString(),
            oldValues: before,
            newValues: after,
            cancellationToken: cancellationToken);

        return after;
    }
}

public record GetPublicBrandQuery(string Token) : IRequest<PublicBrandDto?>;

public class GetPublicBrandHandler(WTFDbContext db) : IRequestHandler<GetPublicBrandQuery, PublicBrandDto?>
{
    public async Task<PublicBrandDto?> Handle(GetPublicBrandQuery request, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(db, request.Token, cancellationToken);
        if (access is null)
        {
            return null;
        }

        return BrandDefaults.ToPublic(await BrandDefaults.LoadAsync(db, access.Link.TenantId, cancellationToken));
    }
}
