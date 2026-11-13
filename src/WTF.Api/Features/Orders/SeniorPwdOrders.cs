using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal sealed class SeniorPwdOrders
{
    public const string ApplyPermission = "orders.seniorpwd.apply";

    private const int MaxIdLength = 50;
    private const int MaxNameLength = 100;

    private readonly List<SeniorPwdPersonRequestDto> _persons;
    private readonly bool _vatRegistered;
    private readonly bool _held;
    private readonly List<(OrderItem Parent, int PersonIndex)> _covered = [];

    private SeniorPwdOrders(List<SeniorPwdPersonRequestDto> persons, bool vatRegistered, bool held)
    {
        _persons = persons;
        _vatRegistered = vatRegistered;
        _held = held;
    }

    public List<OrderSeniorPwdDiscount> Rows { get; private set; } = [];

    // Null when the order has no Senior/PWD person. A held offline order records what was sold at the till, so its rules
    // (switch, permission, eligibility) are not judged again; an Admin reviews it instead.
    public static async Task<SeniorPwdOrders?> LoadAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        IReadOnlyList<SeniorPwdPersonRequestDto>? persons,
        IReadOnlyList<OrderItemRequestDto> items,
        bool held,
        bool isCustomerLinkOrder,
        bool switchMayBeOff,
        CancellationToken cancellationToken)
    {
        persons ??= [];
        var hasIndexes = items.Any(i => i.SeniorPwdPersonIndex.HasValue);
        if (persons.Count == 0 && !hasIndexes)
        {
            return null;
        }

        if (persons.Count == 0)
        {
            throw new InvalidOperationException("Add the Senior/PWD person for the covered items.");
        }

        if (items.Any(i => i.SeniorPwdPersonIndex is { } index && (index < 0 || index >= persons.Count)))
        {
            throw new InvalidOperationException("A covered item points to a Senior/PWD person that is not on the order.");
        }

        var settings = await db.TenantSettings
            .AsNoTracking()
            .Select(s => new { s.SeniorPwdEnabled, s.VatRegistered })
            .FirstOrDefaultAsync(cancellationToken);

        var cleaned = persons.Select(person => Clean(person, held)).ToList();

        if (!held)
        {
            // An Admin correcting an order that already has the discount can still do so after the shop turned it off.
            if (!switchMayBeOff && settings is not { SeniorPwdEnabled: true })
            {
                throw new InvalidOperationException("The Senior/PWD discount is turned off for this shop.");
            }

            if (!PermissionChecks.Has(httpContextAccessor.HttpContext?.User, ApplyPermission))
            {
                throw new InvalidOperationException("You are not allowed to apply the Senior/PWD discount.");
            }

            foreach (var person in cleaned)
            {
                Validate(person, isCustomerLinkOrder);
            }
        }

        return new SeniorPwdOrders(cleaned, settings?.VatRegistered ?? false, held);
    }

    public static string MaskId(string idNumber)
    {
        var visible = Math.Min(4, Math.Max(0, idNumber.Length - 4));
        return new string('*', idNumber.Length - visible) + idNumber[^visible..];
    }

    public static List<OrderSeniorPwdDto>? ToDtos(IEnumerable<OrderSeniorPwdDiscount> rows, bool mask)
    {
        var list = rows
            .OrderBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .Select(r => new OrderSeniorPwdDto(
                r.Id,
                (SeniorPwdTypeEnum)r.Type,
                mask ? MaskId(r.IdNumber) : r.IdNumber,
                r.CustomerName,
                r.CoveredAmount,
                r.VatExemptAmount,
                r.DiscountAmount))
            .ToList();
        return list.Count == 0 ? null : list;
    }

    public static bool CanSeeFullId(IHttpContextAccessor? httpContextAccessor)
    {
        var user = httpContextAccessor?.HttpContext?.User;
        return PermissionChecks.HasAny(user, [ApplyPermission, "orders.override"]);
    }

    public static object AuditValues(OrderSeniorPwdDiscount row) => new
    {
        Type = (SeniorPwdTypeEnum)row.Type,
        Id = MaskId(row.IdNumber),
        row.CustomerName,
        row.CoveredAmount,
        row.VatExemptAmount,
        row.DiscountAmount
    };

    public static string Signature(IEnumerable<OrderSeniorPwdDiscount> rows) =>
        string.Join("|", rows
            .Select(r => $"{r.Type}:{r.IdNumber}:{r.CustomerName}:{r.CoveredAmount}:{r.VatExemptAmount}:{r.DiscountAmount}")
            .Order());

    public static async Task LogChangesAsync(
        IAuditService auditService,
        Order order,
        IReadOnlyCollection<OrderSeniorPwdDiscount> before,
        IReadOnlyCollection<OrderSeniorPwdDiscount> after,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (Signature(before) == Signature(after))
        {
            return;
        }

        foreach (var row in before)
        {
            await auditService.LogAsync(
                AuditAction.SeniorPwdDiscountRemoved,
                AuditEntityType.Order,
                order.Id.ToString(),
                oldValues: new { order.OrderNumber, Person = AuditValues(row) },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        foreach (var row in after)
        {
            await auditService.LogAsync(
                AuditAction.SeniorPwdDiscountApplied,
                AuditEntityType.Order,
                order.Id.ToString(),
                newValues: new { order.OrderNumber, Person = AuditValues(row) },
                userId: userId,
                cancellationToken: cancellationToken);
        }
    }

    public SeniorPwdAmounts AmountsFor(decimal unitPrice, decimal addOnsPerUnit, int quantity) =>
        SeniorPwdRules.ForRow((unitPrice + addOnsPerUnit) * quantity, _vatRegistered);

    public void EnsureLineAllowed(string productName, bool productEligible, bool hasPromotion, bool isBundle)
    {
        if (_held || SeniorPwdRules.IsEligibleLine(productEligible, hasPromotion, isBundle))
        {
            return;
        }

        var reason = !productEligible
            ? "is not food or drink, so it cannot take the Senior/PWD discount"
            : isBundle
                ? "is part of a bundle, so it cannot take the Senior/PWD discount"
                : "already has a promotion price, so it cannot take the Senior/PWD discount";
        throw new InvalidOperationException($"{productName} {reason}.");
    }

    public void CreateRows(Guid orderId, Guid recordedBy, DateTime createdAt)
    {
        Rows = _persons
            .Select(person => new OrderSeniorPwdDiscount
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                Type = (byte)person.Type,
                IdNumber = person.IdNumber,
                CustomerName = person.CustomerName,
                RecordedBy = recordedBy,
                CreatedAt = createdAt
            })
            .ToList();
    }

    public void Cover(int personIndex, OrderItem parent, SeniorPwdAmounts amounts)
    {
        var row = Rows[personIndex];
        _covered.Add((parent, personIndex));
        parent.SeniorPwdVatExempt = amounts.VatExempt;
        parent.SeniorPwdDiscount = amounts.Discount;
        row.CoveredAmount += amounts.Covered;
        row.VatExemptAmount += amounts.VatExempt;
        row.DiscountAmount += amounts.Discount;
    }

    // The person rows are saved with their final amounts, then the covered lines point at them.
    public void Complete(WTFDbContext db)
    {
        db.OrderSeniorPwdDiscounts.AddRange(Rows);
        foreach (var (parent, personIndex) in _covered)
        {
            parent.SeniorPwdDiscountId = Rows[personIndex].Id;
        }
    }

    public void EnsureEveryPersonCovered()
    {
        if (_held)
        {
            return;
        }

        for (var index = 0; index < Rows.Count; index++)
        {
            if (Rows[index].CoveredAmount <= 0m)
            {
                throw new InvalidOperationException($"{_persons[index].CustomerName} has no item covered by the Senior/PWD discount.");
            }
        }
    }

    private static SeniorPwdPersonRequestDto Clean(SeniorPwdPersonRequestDto person, bool held)
    {
        var idNumber = (person.IdNumber ?? string.Empty).Trim();
        var name = (person.CustomerName ?? string.Empty).Trim();
        if (held)
        {
            idNumber = idNumber.Length > MaxIdLength ? idNumber[..MaxIdLength] : idNumber;
            name = name.Length > MaxNameLength ? name[..MaxNameLength] : name;
        }

        return person with { IdNumber = idNumber, CustomerName = name };
    }

    private static void Validate(SeniorPwdPersonRequestDto person, bool requireIdChecked)
    {
        if (!Enum.IsDefined(person.Type))
        {
            throw new InvalidOperationException("Pick Senior or PWD for the discount.");
        }

        if (person.IdNumber.Length == 0 || person.CustomerName.Length == 0)
        {
            throw new InvalidOperationException("The Senior/PWD discount needs the ID number and the name on the ID.");
        }

        if (person.IdNumber.Length > MaxIdLength || person.IdNumber.Any(char.IsControl))
        {
            throw new InvalidOperationException($"The ID number is not valid ({MaxIdLength} characters at most).");
        }

        if (person.CustomerName.Length > MaxNameLength || person.CustomerName.Any(char.IsControl))
        {
            throw new InvalidOperationException($"The name on the ID is not valid ({MaxNameLength} characters at most).");
        }

        if (requireIdChecked && !person.IdChecked)
        {
            throw new InvalidOperationException("Check the ID before applying the Senior/PWD discount to an online order.");
        }
    }
}
