using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Items;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Suppliers;

public record SupplierFields(
    string? Name,
    string? ContactName,
    string? Phone,
    string? Email,
    string? Address,
    int? LeadTimeDays,
    string? PaymentTerms,
    string? Notes);

internal static class SupplierRules
{
    public const int MaxNameLength = 100;

    public static async Task<string> ValidateAsync(
        WTFDbContext db,
        SupplierFields fields,
        Guid? exceptId,
        CancellationToken cancellationToken)
    {
        var name = fields.Name?.Trim();
        if (string.IsNullOrEmpty(name))
        {
            throw new InvalidOperationException("Enter the supplier's name.");
        }

        if (name.Length > MaxNameLength)
        {
            throw new InvalidOperationException($"The supplier name can be at most {MaxNameLength} characters.");
        }

        if (fields.LeadTimeDays is < 0 or > 365)
        {
            throw new InvalidOperationException("Lead time must be between 0 and 365 days.");
        }

        CheckLength(fields.ContactName, 100, "Contact name");
        CheckLength(fields.Phone, 30, "Phone");
        CheckLength(fields.Email, 150, "Email");
        CheckLength(fields.Address, 300, "Address");
        CheckLength(fields.PaymentTerms, 100, "Payment terms");
        CheckLength(fields.Notes, 500, "Notes");

        var lower = name.ToLower();
        var taken = await db.Suppliers.AnyAsync(
            s => s.Name.ToLower() == lower && (exceptId == null || s.Id != exceptId),
            cancellationToken);
        if (taken)
        {
            throw new InvalidOperationException($"A supplier named \"{name}\" already exists.");
        }

        return name;
    }

    public static void Apply(Supplier supplier, SupplierFields fields, string name)
    {
        supplier.Name = name;
        supplier.ContactName = ItemValidation.NormalizeOptional(fields.ContactName);
        supplier.Phone = ItemValidation.NormalizeOptional(fields.Phone);
        supplier.Email = ItemValidation.NormalizeOptional(fields.Email);
        supplier.Address = ItemValidation.NormalizeOptional(fields.Address);
        supplier.LeadTimeDays = fields.LeadTimeDays;
        supplier.PaymentTerms = ItemValidation.NormalizeOptional(fields.PaymentTerms);
        supplier.Notes = ItemValidation.NormalizeOptional(fields.Notes);
    }

    public static SupplierSummaryDto ToSummary(Supplier supplier, int itemCount) =>
        new(supplier.Id, supplier.Name, supplier.ContactName, supplier.Phone, supplier.Email, supplier.Address,
            supplier.LeadTimeDays, supplier.PaymentTerms, supplier.Notes, supplier.IsActive, itemCount);

    public static async Task<SupplierDto?> LoadAsync(WTFDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var supplier = await db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (supplier is null)
        {
            return null;
        }

        var links = await db.ItemSuppliers
            .AsNoTracking()
            .Where(l => l.SupplierId == id)
            .OrderBy(l => l.Item.Name)
            .Select(l => new
            {
                l.Id,
                l.ItemId,
                ItemName = l.Item.Name,
                l.Item.UnitName,
                l.SupplierItemCode,
                l.PackName,
                l.UnitsPerPack,
                l.PackPrice,
                l.IsPreferred
            })
            .ToListAsync(cancellationToken);

        var items = links
            .Select(l => new SupplierItemDto(
                l.Id, l.ItemId, l.ItemName, l.UnitName, l.SupplierItemCode, l.PackName, l.UnitsPerPack, l.PackPrice,
                PurchasingRules.UnitCost(l.PackPrice, l.UnitsPerPack), l.IsPreferred))
            .ToList();

        return new SupplierDto(ToSummary(supplier, items.Count), items);
    }

    private static void CheckLength(string? value, int max, string label)
    {
        if (value is not null && value.Trim().Length > max)
        {
            throw new InvalidOperationException($"{label} can be at most {max} characters.");
        }
    }
}
