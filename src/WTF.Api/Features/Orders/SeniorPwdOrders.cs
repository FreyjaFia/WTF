using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Orders.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal sealed class SeniorPwdOrders
{
    public const int MaxIdLength = 50;

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

    // A held offline order records what was sold at the till, so its rules (switch, permission, eligibility) are not
    // judged again; an Admin reviews it instead.
    public static async Task<SeniorPwdOrders?> LoadAsync(
        WTFDbContext db,
        IHttpContextAccessor httpContextAccessor,
        IReadOnlyList<SeniorPwdPersonRequestDto>? persons,
        IReadOnlyList<OrderItemRequestDto> items,
        bool held,
        bool isCustomerLinkOrder,
        bool switchMayBeOff,
        CancellationToken cancellationToken,
        bool? vatRegisteredOverride = null)
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

        var settings = await TenantSettingsLookup.LoadSeniorPwdAsync(db, cancellationToken);

        var cleaned = SeniorPwdValidator.Clean(persons, held);

        if (!held)
        {
            // An Admin correcting an order that already has the discount can still do so after the shop turned it off.
            if (!switchMayBeOff && !settings.Enabled)
            {
                throw new InvalidOperationException("The Senior/PWD discount is turned off for this shop.");
            }

            if (!PermissionChecks.Has(httpContextAccessor.HttpContext?.User, PermissionKeys.OrdersSeniorPwdApply))
            {
                throw new ForbiddenActionException("You are not allowed to apply the Senior/PWD discount.");
            }

            SeniorPwdValidator.Validate(cleaned, isCustomerLinkOrder);
        }

        return new SeniorPwdOrders(cleaned, vatRegisteredOverride ?? settings.VatRegistered, held);
    }

    public SeniorPwdAmounts AmountsFor(decimal unitPrice, decimal addOnsPerUnit, int quantity) =>
        SeniorPwdRules.ForLine(unitPrice, addOnsPerUnit, quantity, _vatRegistered);

    public void EnsureLineAllowed(string productName, bool productEligible, bool hasPromotion, bool isBundle)
    {
        if (_held || SeniorPwdRules.IsEligibleLine(productEligible, hasPromotion, isBundle))
        {
            return;
        }

        throw new InvalidOperationException(SeniorPwdReasons.Ineligible(productName, productEligible, hasPromotion, isBundle));
    }

    public List<OrderSeniorPwdDiscount> CreateRows(
        Guid orderId,
        Guid recordedBy,
        DateTime createdAt,
        IEnumerable<OrderSeniorPwdDiscount>? existing = null)
    {
        var unused = (existing ?? []).ToList();
        Rows = _persons
            .Select(person =>
            {
                var kept = unused.FirstOrDefault(row => row.Type == (byte)person.Type
                    && SeniorPwdRules.IdKey(row.IdNumber) == SeniorPwdRules.IdKey(person.IdNumber)
                    && row.CustomerName == person.CustomerName);
                if (kept is null)
                {
                    return new OrderSeniorPwdDiscount
                    {
                        Id = Guid.NewGuid(),
                        OrderId = orderId,
                        Type = (byte)person.Type,
                        IdNumber = person.IdNumber,
                        CustomerName = person.CustomerName,
                        RecordedBy = recordedBy,
                        CreatedAt = createdAt
                    };
                }

                unused.Remove(kept);
                kept.IdNumber = person.IdNumber;
                kept.CoveredAmount = 0m;
                kept.VatExemptAmount = 0m;
                kept.DiscountAmount = 0m;
                return kept;
            })
            .ToList();

        return unused;
    }

    public void CoverLine(OrderItemRequestDto item, Product product, OrderItem saved, SeniorPwdAmounts amounts)
    {
        if (item.SeniorPwdPersonIndex is not { } personIndex)
        {
            return;
        }

        EnsureLineAllowed(product.Name, product.IsSeniorPwdEligible, saved.DiscountPromotionId.HasValue, item.BundlePromotionId.HasValue);
        Cover(personIndex, saved, amounts);
    }

    private void Cover(int personIndex, OrderItem parent, SeniorPwdAmounts amounts)
    {
        var row = Rows[personIndex];
        _covered.Add((parent, personIndex));
        parent.SeniorPwdVatExempt = amounts.VatExempt;
        parent.SeniorPwdDiscount = amounts.Discount;
        row.CoveredAmount += amounts.Covered;
        row.VatExemptAmount += amounts.VatExempt;
        row.DiscountAmount += amounts.Discount;
    }

    public void Complete(WTFDbContext db)
    {
        db.OrderSeniorPwdDiscounts.AddRange(Rows.Where(row => db.Entry(row).State == EntityState.Detached));
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


}
