using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Transfers;

public record CreateStockTransferCommand : IRequest<StockTransferDto>
{
    public Guid ToBranchId { get; init; }

    [StringLength(500)]
    public string? Notes { get; init; }

    [Required]
    [MinLength(1)]
    [MaxLength(200)]
    public List<StockTransferLineRequest> Lines { get; init; } = [];
}

// Goods leave the branch the person works in and arrive in another branch of the same shop, in one transaction: a
// TransferOut and a TransferIn movement with one reference, the balances of both branches, and one transfer record.
public class CreateStockTransferHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    IStockAlertService stockAlerts) : IRequestHandler<CreateStockTransferCommand, StockTransferDto>
{
    public async Task<StockTransferDto> Handle(CreateStockTransferCommand request, CancellationToken cancellationToken)
    {
        var fromBranchId = await StockBalance.ResolveBranchAsync(db, cancellationToken);
        if (request.ToBranchId == fromBranchId)
        {
            throw new InvalidOperationException("Choose a different branch to send the stock to.");
        }

        var branches = await db.Branches
            .IgnoreQueryFilters([WTFDbContext.BranchFilterName])
            .AsNoTracking()
            .Where(b => b.Id == fromBranchId || b.Id == request.ToBranchId)
            .ToListAsync(cancellationToken);
        var from = branches.FirstOrDefault(b => b.Id == fromBranchId)
            ?? throw new InvalidOperationException("The sending branch was not found.");
        var to = branches.FirstOrDefault(b => b.Id == request.ToBranchId)
            ?? throw new InvalidOperationException("The branch to send the stock to was not found.");
        if (!to.IsActive)
        {
            throw new InvalidOperationException($"{to.Name} is closed, so it cannot receive stock.");
        }

        var notes = ItemValidation.NormalizeOptional(request.Notes);
        var lines = request.Lines
            .GroupBy(l => l.ItemId)
            .Select(g => new StockTransferLineRequest(g.Key, g.Sum(l => l.Quantity)))
            .ToList();
        if (lines.Count == 0 || lines.Any(l => l.Quantity <= 0m || l.Quantity > 999999.999m))
        {
            throw new InvalidOperationException("Enter a quantity above zero for every item.");
        }

        var itemIds = lines.Select(l => l.ItemId).ToList();
        var items = await db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);
        foreach (var line in lines)
        {
            if (!items.TryGetValue(line.ItemId, out var item))
            {
                throw new InvalidOperationException("One of the items was not found.");
            }

            if (!item.IsActive)
            {
                throw new InvalidOperationException($"{item.Name} is inactive. Restore it before moving its stock.");
            }
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        db.AllowWritesTo(to.Id);

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var transfer = new StockTransfer
        {
            Id = Guid.NewGuid(),
            FromBranchId = from.Id,
            ToBranchId = to.Id,
            Notes = notes,
            CreatedAt = now,
            CreatedBy = userId
        };
        db.StockTransfers.Add(transfer);

        var tick = 0;
        foreach (var line in lines.OrderBy(l => items[l.ItemId].Name))
        {
            var item = items[line.ItemId];
            var cost = CostRules.MovementCost(item.AverageCost, item.CostPrice);

            var taken = await StockBalance.ApplyAsync(db, item.Id, from.Id, -line.Quantity, false, cancellationToken)
                ?? throw new InvalidOperationException(await ShortMessageAsync(item, from, line.Quantity, cancellationToken));
            var given = await StockBalance.ApplyAsync(db, item.Id, to.Id, line.Quantity, true, cancellationToken)
                ?? throw new InvalidOperationException($"{item.Name} could not be added to {to.Name}.");

            db.StockMovements.Add(new StockMovement
            {
                ItemId = item.Id,
                BranchId = from.Id,
                MovementType = StockMovementTypes.TransferOut,
                QuantityDelta = -line.Quantity,
                QuantityBefore = taken.Before,
                QuantityAfter = taken.After,
                UnitCost = cost,
                ReferenceType = StockMovementTypes.StockTransferReference,
                ReferenceId = transfer.Id,
                Notes = $"Sent to {to.Name}",
                CreatedAt = now.AddTicks(tick++),
                CreatedBy = userId
            });
            db.StockMovements.Add(new StockMovement
            {
                ItemId = item.Id,
                BranchId = to.Id,
                MovementType = StockMovementTypes.TransferIn,
                QuantityDelta = line.Quantity,
                QuantityBefore = given.Before,
                QuantityAfter = given.After,
                UnitCost = cost,
                ReferenceType = StockMovementTypes.StockTransferReference,
                ReferenceId = transfer.Id,
                Notes = $"Received from {from.Name}",
                CreatedAt = now.AddTicks(tick++),
                CreatedBy = userId
            });
            db.StockTransferLines.Add(new StockTransferLine
            {
                Id = Guid.NewGuid(),
                TransferId = transfer.Id,
                ItemId = item.Id,
                Quantity = line.Quantity,
                UnitCost = cost
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        await stockAlerts.EvaluateAsync(itemIds, from.Id, cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.StockTransferred,
            AuditEntityType.StockTransfer,
            transfer.Id.ToString(),
            newValues: new
            {
                From = from.Name,
                To = to.Name,
                notes,
                Lines = lines.Select(l => new { items[l.ItemId].Name, l.Quantity })
            },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await new GetStockTransferHandler(db).Handle(new GetStockTransferQuery(transfer.Id), cancellationToken))!;
    }

    private async Task<string> ShortMessageAsync(Item item, Branch from, decimal needed, CancellationToken cancellationToken)
    {
        var balance = await StockBalance.QuantityAsync(db, item.Id, from.Id, cancellationToken);
        var unit = InventoryUnitLabels.Abbreviate(item.UnitName);
        return $"Not enough {item.Name} in {from.Name}: sending {needed:0.###} {unit}, {Math.Max(0m, balance):0.###} {unit} in stock. This item cannot go below zero.";
    }
}
