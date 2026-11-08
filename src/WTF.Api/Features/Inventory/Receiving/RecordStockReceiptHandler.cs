using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Receiving;

public record ReceiptLineRequest
{
    public Guid ItemId { get; init; }

    [Range(0.001, 999999.999)]
    public decimal Packs { get; init; }

    [Range(0.001, 999999.999)]
    public decimal UnitsPerPack { get; init; } = 1m;

    [Range(0, 9999999.99)]
    public decimal? PackPrice { get; init; }

    [StringLength(50)]
    public string? PackName { get; init; }
}

public record RecordStockReceiptCommand : IRequest<StockReceiptDto>
{
    public Guid SupplierId { get; init; }

    public DateOnly ReceivedOn { get; init; }

    [StringLength(50)]
    public string? InvoiceNumber { get; init; }

    [Range(0, 99999999.99)]
    public decimal? InvoiceTotal { get; init; }

    [StringLength(500)]
    public string? Note { get; init; }

    public Guid? ClientRequestId { get; init; }

    public Guid? PurchaseOrderId { get; init; }

    [MaxLength(200)]
    public List<ReceiptLineRequest> Lines { get; init; } = [];
}

public class RecordStockReceiptHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<RecordStockReceiptCommand, StockReceiptDto>
{
    private const int MaxDaysBack = 366;

    public async Task<StockReceiptDto> Handle(RecordStockReceiptCommand request, CancellationToken cancellationToken)
    {
        if (request.ClientRequestId.HasValue)
        {
            var existing = await db.StockReceipts
                .AsNoTracking()
                .Where(r => r.ClientRequestId == request.ClientRequestId)
                .Select(r => (Guid?)r.Id)
                .FirstOrDefaultAsync(cancellationToken);
            if (existing.HasValue)
            {
                return (await ReceiptMapping.LoadAsync(db, existing.Value, cancellationToken))!;
            }
        }

        if (request.Lines.Count == 0)
        {
            throw new InvalidOperationException("Add at least one item to the receipt.");
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (request.ReceivedOn > today.AddDays(1) || request.ReceivedOn < today.AddDays(-MaxDaysBack))
        {
            throw new InvalidOperationException("Check the received date.");
        }

        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == request.SupplierId, cancellationToken)
            ?? throw new InvalidOperationException("Choose the supplier these goods came from.");
        if (!supplier.IsActive)
        {
            throw new InvalidOperationException("This supplier is inactive. Restore it before receiving from it.");
        }

        PurchaseOrder? order = null;
        if (request.PurchaseOrderId.HasValue)
        {
            order = await db.PurchaseOrders.Include(o => o.PurchaseOrderLines)
                    .FirstOrDefaultAsync(o => o.Id == request.PurchaseOrderId, cancellationToken)
                ?? throw new InvalidOperationException("The purchase order was not found.");
            if (!PurchaseOrderStatuses.IsOpen(order.Status))
            {
                throw new InvalidOperationException("This purchase order is not waiting for goods. Send it first, or it may already be closed.");
            }

            if (order.SupplierId != supplier.Id)
            {
                throw new InvalidOperationException("This purchase order belongs to a different supplier.");
            }

            if (request.Lines.Any(l => order.PurchaseOrderLines.All(ol => ol.ItemId != l.ItemId)))
            {
                throw new InvalidOperationException("Every item received must be on the purchase order.");
            }
        }

        var itemIds = request.Lines.Select(l => l.ItemId).ToList();
        if (itemIds.Distinct().Count() != itemIds.Count)
        {
            throw new InvalidOperationException("Each item can appear only once on a receipt.");
        }

        var items = await db.Items.Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);
        foreach (var line in request.Lines)
        {
            if (!items.TryGetValue(line.ItemId, out var item))
            {
                throw new InvalidOperationException("One of the items was not found.");
            }

            if (!item.IsActive)
            {
                throw new InvalidOperationException($"{item.Name} is inactive. Restore it before receiving stock.");
            }

            if (line.Packs <= 0m || line.UnitsPerPack <= 0m)
            {
                throw new InvalidOperationException($"Enter the packs and the units in a pack for {item.Name}.");
            }
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        var invoiceNumber = ItemValidation.NormalizeOptional(request.InvoiceNumber);

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var receipt = new StockReceipt
        {
            SupplierId = supplier.Id,
            ReceivedOn = request.ReceivedOn,
            PurchaseOrderId = order?.Id,
            InvoiceNumber = invoiceNumber,
            InvoiceTotal = request.InvoiceTotal,
            Note = ItemValidation.NormalizeOptional(request.Note),
            ClientRequestId = request.ClientRequestId,
            CreatedAt = now,
            CreatedBy = userId
        };
        db.StockReceipts.Add(receipt);
        await db.SaveChangesAsync(cancellationToken);

        var links = await db.ItemSuppliers.Where(l => itemIds.Contains(l.ItemId)).ToListAsync(cancellationToken);
        var movementNote = invoiceNumber is null
            ? $"Received from {supplier.Name}"
            : $"Received from {supplier.Name}, invoice {invoiceNumber}";

        foreach (var line in request.Lines)
        {
            var item = items[line.ItemId];
            var quantity = PurchasingRules.UnitsFromPacks(line.Packs, line.UnitsPerPack);
            var unitCost = PurchasingRules.UnitCost(line.PackPrice, line.UnitsPerPack);

            var applied = await StockBalance.ApplyAsync(db, item.Id, quantity, true, cancellationToken)
                ?? throw new InvalidOperationException($"{item.Name} was not found.");

            item.UpdatedAt = now;
            item.UpdatedBy = userId;
            if (unitCost.HasValue)
            {
                if (item.CostPrice != unitCost)
                {
                    db.ItemPriceHistories.Add(new ItemPriceHistory
                    {
                        ItemId = item.Id,
                        OldPrice = item.CostPrice,
                        NewPrice = unitCost.Value,
                        UpdatedAt = now,
                        UpdatedBy = userId
                    });
                }

                item.CostPrice = unitCost;
                item.AverageCost = CostRules.WeightedAverage(applied.Before, item.AverageCost, quantity, unitCost.Value);
            }

            var movement = new StockMovement
            {
                ItemId = item.Id,
                MovementType = StockMovementTypes.AddStock,
                QuantityDelta = quantity,
                QuantityBefore = applied.Before,
                QuantityAfter = applied.After,
                UnitCost = unitCost,
                ReferenceType = StockMovementTypes.StockReceiptReference,
                ReferenceId = receipt.Id,
                Notes = movementNote,
                CreatedAt = now,
                CreatedBy = userId
            };
            db.StockMovements.Add(movement);

            db.StockReceiptLines.Add(new StockReceiptLine
            {
                ReceiptId = receipt.Id,
                ItemId = item.Id,
                PackName = ItemValidation.NormalizeOptional(line.PackName),
                Packs = line.Packs,
                UnitsPerPack = line.UnitsPerPack,
                PackPrice = line.PackPrice,
                Quantity = quantity,
                UnitCost = unitCost,
                MovementId = movement.Id
            });

            RememberPack(links, item, supplier, line, now, userId);

            if (order is not null)
            {
                order.PurchaseOrderLines.First(ol => ol.ItemId == item.Id).PacksReceived += line.Packs;
            }
        }

        if (order is not null)
        {
            var progress = PurchasingRules.Progress(order.PurchaseOrderLines.Select(ol => (ol.PacksOrdered, ol.PacksReceived)));
            order.Status = progress == OrderProgress.Complete ? PurchaseOrderStatuses.Received : PurchaseOrderStatuses.PartlyReceived;
            if (progress == OrderProgress.Complete)
            {
                order.ClosedAt = now;
                order.ClosedBy = userId;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await stockAlerts.EvaluateAsync(itemIds, cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.StockReceived,
            AuditEntityType.StockReceipt,
            receipt.Id.ToString(),
            newValues: new
            {
                SupplierName = supplier.Name,
                receipt.ReceivedOn,
                receipt.InvoiceNumber,
                receipt.InvoiceTotal,
                Lines = request.Lines.Count
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await ReceiptMapping.LoadAsync(db, receipt.Id, cancellationToken))!;
    }

    // What a delivery shows about the supplier's pack is kept on the item's supplier link: a first delivery creates the
    // link (the first supplier of an item becomes its preferred one) and a changed pack price is written to the history.
    private void RememberPack(
        List<ItemSupplier> links,
        Item item,
        Supplier supplier,
        ReceiptLineRequest line,
        DateTime now,
        Guid userId)
    {
        var link = links.FirstOrDefault(l => l.ItemId == item.Id && l.SupplierId == supplier.Id);
        if (link is null)
        {
            link = new ItemSupplier
            {
                ItemId = item.Id,
                SupplierId = supplier.Id,
                PackName = ItemValidation.NormalizeOptional(line.PackName),
                UnitsPerPack = line.UnitsPerPack,
                PackPrice = line.PackPrice,
                IsPreferred = !links.Any(l => l.ItemId == item.Id && l.IsPreferred),
                CreatedAt = now,
                CreatedBy = userId
            };
            links.Add(link);
            db.ItemSuppliers.Add(link);
            if (line.PackPrice.HasValue)
            {
                db.ItemSupplierPriceHistories.Add(PriceChange(null, line.PackPrice.Value, now, userId, link));
            }

            return;
        }

        var changed = link.UnitsPerPack != line.UnitsPerPack;
        link.UnitsPerPack = line.UnitsPerPack;
        if (ItemValidation.NormalizeOptional(line.PackName) is { } packName && packName != link.PackName)
        {
            link.PackName = packName;
            changed = true;
        }

        if (line.PackPrice.HasValue && line.PackPrice != link.PackPrice)
        {
            db.ItemSupplierPriceHistories.Add(PriceChange(link.PackPrice, line.PackPrice.Value, now, userId, link));
            link.PackPrice = line.PackPrice;
            changed = true;
        }

        if (changed)
        {
            link.UpdatedAt = now;
            link.UpdatedBy = userId;
        }
    }

    private static ItemSupplierPriceHistory PriceChange(decimal? oldPrice, decimal newPrice, DateTime now, Guid userId, ItemSupplier link) =>
        new()
        {
            ItemSupplier = link,
            OldPackPrice = oldPrice,
            NewPackPrice = newPrice,
            Source = "Receipt",
            ChangedAt = now,
            ChangedBy = userId
        };
}
