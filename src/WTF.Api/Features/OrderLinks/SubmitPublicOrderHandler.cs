using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using WTF.Api.Common.Orders;
using WTF.Api.Common.Time;
using WTF.Api.Features.OrderLinks.DTOs;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Orders;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.OrderLinks;

public record PublicOrderAddOnRequest(Guid ProductId, int Quantity);

public record PublicOrderItemRequest(
    Guid ProductId,
    int Quantity,
    List<PublicOrderAddOnRequest>? AddOns,
    string? SpecialInstructions);

/// <summary>What a customer sends to place an order. Prices are never part of it: the server works them out.</summary>
public record SubmitPublicOrderRequest(
    List<PublicOrderItemRequest> Items,
    FulfillmentTypeEnum Fulfillment,
    string? DeliveryAddress,
    string? ContactNumber,
    PaymentMethodEnum PaymentMethod,
    decimal? AmountReceived,
    string? SpecialInstructions,
    decimal? Tips = null,
    decimal? ExpectedTotal = null);

public record SubmitPublicOrderCommand(string Token, SubmitPublicOrderRequest Request) : IRequest<PublicOrderDto?>;

/// <summary>
/// Places an order for the customer behind a valid ordering link. The order is created through the normal
/// <see cref="CreateOrderCommand"/>, so the add-on, size and flavor rules, inactive products and prices are checked
/// in the one place that already does it. It starts as waiting for approval, owned by the system user.
/// </summary>
public class SubmitPublicOrderHandler(
    WTFDbContext db,
    ISender sender,
    ILogger<SubmitPublicOrderHandler> logger,
    TimeProvider timeProvider,
    IHttpContextAccessor? httpContextAccessor = null) : IRequestHandler<SubmitPublicOrderCommand, PublicOrderDto?>
{
    public const string SystemUsername = "customer-link";

    public const int MaxLines = 30;
    public const int MaxQuantity = 99;
    public const int MaxAddOnsPerLine = 20;
    public const int MaxAddressLength = 300;
    public const int MaxContactLength = 30;
    public const int MaxWaitingOrders = 5;
    public const decimal MaxCashAmount = 1_000_000m;
    public const decimal MaxTip = 100_000m;

    // Digits, spaces, + ( ) and -, with at least 7 digits.
    private static readonly Regex ContactPattern = new(@"^[0-9+()\-\s]+$", RegexOptions.Compiled);

    public async Task<PublicOrderDto?> Handle(SubmitPublicOrderCommand command, CancellationToken cancellationToken)
    {
        var access = await OrderLinkAccess.ResolveAsync(
            db, command.Token, cancellationToken, timeProvider.GetUtcNow().UtcDateTime);
        if (access == null)
        {
            return null;
        }

        var request = command.Request ?? throw new InvalidOperationException("The order is missing.");
        var lines = NormalizeItems(request.Items);

        if (!Enum.IsDefined(request.Fulfillment))
        {
            throw new InvalidOperationException("Please choose pickup or delivery.");
        }

        if (!Enum.IsDefined(request.PaymentMethod))
        {
            throw new InvalidOperationException("Please choose how you will pay.");
        }

        var contact = (request.ContactNumber ?? string.Empty).Trim();
        EnsureContact(contact);

        string? address = null;
        if (request.Fulfillment == FulfillmentTypeEnum.Delivery)
        {
            address = (request.DeliveryAddress ?? string.Empty).Trim();
            if (address.Length == 0)
            {
                throw new InvalidOperationException("A delivery address is required for delivery.");
            }

            if (address.Length > MaxAddressLength)
            {
                throw new InvalidOperationException($"The delivery address cannot be longer than {MaxAddressLength} characters.");
            }
        }

        var instructions = string.IsNullOrWhiteSpace(request.SpecialInstructions)
            ? null
            : request.SpecialInstructions.Trim();

        // The total the customer is told, and the uses the order then holds, must come from the same view of the promotion uses.
        using var gate = await PromotionLimitGate.EnterAsync(cancellationToken);

        var total = await ComputeTotalAsync(lines, cancellationToken);

        // The page showed a total built from the promotions it knew. If one ran out or changed since, the customer is asked to
        // look again instead of being charged a total they never saw.
        OrderTotalCheck.EnsureUnchanged(request.ExpectedTotal, total);

        // An optional tip for the shop, on top of the total. Zero is the same as none.
        var tip = Math.Round(request.Tips ?? 0m, 2, MidpointRounding.AwayFromZero);
        if (tip < 0)
        {
            throw new InvalidOperationException("The tip cannot be negative.");
        }

        if (tip > MaxTip)
        {
            throw new InvalidOperationException("That tip is too large.");
        }

        var toPay = total + tip;

        decimal? amountReceived = null;
        decimal? change = null;
        if (request.PaymentMethod == PaymentMethodEnum.Cash)
        {
            if (!request.AmountReceived.HasValue)
            {
                throw new InvalidOperationException("Please enter the amount you will pay in cash.");
            }

            amountReceived = Math.Round(request.AmountReceived.Value, 2, MidpointRounding.AwayFromZero);
            if (amountReceived > MaxCashAmount)
            {
                throw new InvalidOperationException("That cash amount is too large.");
            }

            if (amountReceived < toPay)
            {
                throw new InvalidOperationException(tip > 0
                    ? $"The cash amount must be at least the order total and tip of PHP {toPay:N2}."
                    : $"The cash amount must be at least the order total of PHP {total:N2}.");
            }

            change = amountReceived - toPay;
        }

        var waiting = await db.Orders.CountAsync(
            o => o.CustomerId == access.Customer.Id
                 && o.Source == (byte)OrderSourceEnum.CustomerLink
                 && o.StatusId == (int)OrderStatusEnum.PendingApproval,
            cancellationToken);
        if (waiting >= MaxWaitingOrders)
        {
            throw new InvalidOperationException(
                $"You already have {waiting} orders waiting for confirmation. Please wait for the shop to respond.");
        }

        var systemUserId = await db.Users
            .Where(u => u.Username == SystemUsername)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (systemUserId == null)
        {
            logger.LogError("The '{Username}' system user is missing, so customer link orders cannot be created.", SystemUsername);
            throw new InvalidOperationException("Ordering is not available right now. Please try again later.");
        }

        // Checking the link at the start is not enough: it may have been revoked or expired while the request was
        // being validated. Ask once more, right before the order is created, and create nothing if it is gone.
        if (!await OrderLinkAccess.IsStillValidAsync(
                db, access.Link.Id, timeProvider.GetUtcNow().UtcDateTime, cancellationToken))
        {
            return null;
        }

        var created = await sender.Send(new CreateOrderCommand
        {
            CustomerId = access.Customer.Id,
            Items = [.. lines.Select(line => new OrderItemRequestDto(
                line.ProductId,
                line.Quantity,
                [.. line.AddOns.Select(a => new OrderItemRequestDto(a.ProductId, a.Quantity, [], null, null))],
                line.SpecialInstructions,
                null))],
            SpecialInstructions = instructions,
            Status = OrderStatusEnum.PendingApproval,
            GateHeld = true,
            PaymentMethod = request.PaymentMethod,
            AmountReceived = amountReceived,
            ChangeAmount = change,
            Tips = tip > 0 ? tip : null,
            ActorUserId = systemUserId,
            Source = OrderSourceEnum.CustomerLink,
            OrderLinkId = access.Link.Id,
            FulfillmentType = request.Fulfillment,
            DeliveryAddress = address,
            ContactNumber = contact
        }, cancellationToken);

        var order = await db.Orders
            .AsNoTracking()
            .Where(o => o.Id == created.Id)
            .Include(o => o.OrderItems).ThenInclude(oi => oi.Product)
            .Include(o => o.OrderBundlePromotions)
            .AsSplitQuery()
            .FirstAsync(cancellationToken);

        return (await PublicOrderMapping.ToDtosAsync(db, [order], httpContextAccessor, cancellationToken))[0];
    }

    private sealed record Line(Guid ProductId, int Quantity, List<PublicOrderAddOnRequest> AddOns, string? SpecialInstructions);

    /// <summary>Checks the sizes and counts, and merges repeated add-ons so each one appears once with its total.</summary>
    private static List<Line> NormalizeItems(List<PublicOrderItemRequest>? items)
    {
        if (items == null || items.Count == 0)
        {
            throw new InvalidOperationException("Your order is empty.");
        }

        if (items.Count > MaxLines)
        {
            throw new InvalidOperationException($"An order can have at most {MaxLines} different items.");
        }

        var lines = new List<Line>();
        foreach (var item in items)
        {
            if (item == null || item.ProductId == Guid.Empty)
            {
                throw new InvalidOperationException("One of the items is not valid.");
            }

            if (item.Quantity < 1 || item.Quantity > MaxQuantity)
            {
                throw new InvalidOperationException($"Each item quantity must be between 1 and {MaxQuantity}.");
            }

            var addOns = (item.AddOns ?? [])
                .GroupBy(a => a.ProductId)
                .Select(group =>
                {
                    var quantity = group.Sum(a => a.Quantity);
                    if (group.Key == Guid.Empty || group.Any(a => a.Quantity < 1) || quantity > MaxQuantity)
                    {
                        throw new InvalidOperationException($"Each add-on quantity must be between 1 and {MaxQuantity}.");
                    }

                    return new PublicOrderAddOnRequest(group.Key, quantity);
                })
                .ToList();

            if (addOns.Count > MaxAddOnsPerLine)
            {
                throw new InvalidOperationException($"An item can have at most {MaxAddOnsPerLine} different add-ons.");
            }

            if (addOns.Any(a => a.ProductId == item.ProductId))
            {
                throw new InvalidOperationException("An item cannot be its own add-on.");
            }

            var itemInstructions = string.IsNullOrWhiteSpace(item.SpecialInstructions)
                ? null
                : item.SpecialInstructions.Trim();

            lines.Add(new Line(item.ProductId, item.Quantity, addOns, itemInstructions));
        }

        return lines;
    }

    private static void EnsureContact(string contact)
    {
        if (contact.Length == 0)
        {
            throw new InvalidOperationException("A contact number is required.");
        }

        if (contact.Length > MaxContactLength
            || !ContactPattern.IsMatch(contact)
            || contact.Count(char.IsDigit) < 7)
        {
            throw new InvalidOperationException("Please enter a valid contact number.");
        }
    }

    /// <summary>
    /// The price the customer will see, from today's catalog: product price plus each add-on at the price set for that
    /// product, less the discounted-product promotions on right now. The shop prices the order again when it completes it.
    /// </summary>
    private async Task<decimal> ComputeTotalAsync(List<Line> lines, CancellationToken cancellationToken)
    {
        var parentIds = lines.Select(l => l.ProductId).Distinct().ToList();
        var addOnIds = lines.SelectMany(l => l.AddOns.Select(a => a.ProductId)).Distinct().ToList();
        var ids = parentIds.Concat(addOnIds).Distinct().ToList();

        var products = await db.Products
            .Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.Price, p.IsActive, p.IsAddOn })
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        const string unavailable = "Some items are no longer available. Please refresh the menu and try again.";
        if (ids.Any(id => !products.TryGetValue(id, out var p) || !p.IsActive))
        {
            throw new InvalidOperationException(unavailable);
        }

        // A main item must be something the shop sells on its own, never an add-on.
        if (parentIds.Any(id => products[id].IsAddOn))
        {
            throw new InvalidOperationException(unavailable);
        }

        var overrides = addOnIds.Count == 0
            ? []
            : await db.ProductAddOnPriceOverrides
                .Where(o => o.IsActive && parentIds.Contains(o.ProductId) && addOnIds.Contains(o.AddOnId))
                .ToDictionaryAsync(o => (o.ProductId, o.AddOnId), o => o.Price, cancellationToken);

        var loaded = await DiscountRuleLoader.LoadAsync(
            db,
            DateTime.UtcNow,
            httpContextAccessor is null ? TimeZoneInfo.Utc : RequestTimeZone.ResolveFromRequest(httpContextAccessor),
            null,
            cancellationToken);

        return lines.Sum(line =>
        {
            var addOnPerUnit = line.AddOns.Sum(a =>
                (overrides.TryGetValue((line.ProductId, a.ProductId), out var price) ? price : products[a.ProductId].Price)
                * a.Quantity);

            // The discount the shop will apply when it completes the order, with the promotions on right now.
            var applied = PromotionPricing.GetDiscountedUnitPrice(
                products[line.ProductId].Price,
                line.ProductId,
                line.AddOns.Select(a => (a.ProductId, a.Quantity)),
                loaded.RulesByProductId,
                line.Quantity,
                loaded.Budget);
            loaded.Budget.Use(applied?.PromotionId, line.Quantity);

            return ((applied?.Price ?? products[line.ProductId].Price) + addOnPerUnit) * line.Quantity;
        });
    }
}
