using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.Reordering;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Calculations.Inventory;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Purchasing;

public record PurchaseOrderLineRequest
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

public record PurchaseOrderFields
{
    public Guid SupplierId { get; init; }

    public DateOnly? ExpectedOn { get; init; }

    [StringLength(500)]
    public string? Note { get; init; }

    [MaxLength(200)]
    public List<PurchaseOrderLineRequest> Lines { get; init; } = [];
}

public record GetPurchaseOrdersQuery(byte? Status = null, Guid? SupplierId = null, bool OpenOnly = false)
    : IRequest<List<PurchaseOrderSummaryDto>>;

public record GetPurchaseOrderQuery(Guid Id) : IRequest<PurchaseOrderDto?>;

public record CreatePurchaseOrderCommand(PurchaseOrderFields Fields) : IRequest<PurchaseOrderDto>;

public record CreatePurchaseOrderFromReorderCommand(Guid SupplierId) : IRequest<PurchaseOrderDto>;

public record UpdatePurchaseOrderCommand(Guid Id, PurchaseOrderFields Fields) : IRequest<PurchaseOrderDto?>;

public record SetPurchaseOrderStatusCommand(Guid Id, string Action) : IRequest<PurchaseOrderDto?>;

public class GetPurchaseOrdersHandler(WTFDbContext db) : IRequestHandler<GetPurchaseOrdersQuery, List<PurchaseOrderSummaryDto>>
{
    public async Task<List<PurchaseOrderSummaryDto>> Handle(GetPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var query = db.PurchaseOrders.AsNoTracking();
        if (request.Status.HasValue)
        {
            query = query.Where(o => o.Status == request.Status);
        }

        if (request.OpenOnly)
        {
            query = query.Where(o => o.Status == PurchaseOrderStatuses.Sent || o.Status == PurchaseOrderStatuses.PartlyReceived);
        }

        if (request.SupplierId.HasValue)
        {
            query = query.Where(o => o.SupplierId == request.SupplierId);
        }

        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .Take(300)
            .Include(o => o.Supplier)
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.PurchaseOrderLines)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return [.. orders.Select(o => PurchaseOrderMapping.ToSummary(o, o.PurchaseOrderLines.ToList()))];
    }
}

public class GetPurchaseOrderHandler(WTFDbContext db) : IRequestHandler<GetPurchaseOrderQuery, PurchaseOrderDto?>
{
    public Task<PurchaseOrderDto?> Handle(GetPurchaseOrderQuery request, CancellationToken cancellationToken) =>
        PurchaseOrderMapping.LoadAsync(db, request.Id, cancellationToken);
}

internal static class PurchaseOrderRules
{
    public static async Task ValidateAsync(WTFDbContext db, PurchaseOrderFields fields, bool requireActiveSupplier, CancellationToken cancellationToken)
    {
        var supplier = await db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.Id == fields.SupplierId, cancellationToken)
            ?? throw new InvalidOperationException("Choose the supplier to order from.");
        if (requireActiveSupplier && !supplier.IsActive)
        {
            throw new InvalidOperationException("This supplier is inactive. Restore it before ordering from it.");
        }

        if (fields.Lines.Count == 0)
        {
            throw new InvalidOperationException("Add at least one item to the order.");
        }

        var itemIds = fields.Lines.Select(l => l.ItemId).ToList();
        if (itemIds.Distinct().Count() != itemIds.Count)
        {
            throw new InvalidOperationException("Each item can appear only once on an order.");
        }

        var found = await db.Items.Where(i => itemIds.Contains(i.Id)).Select(i => new { i.Id, i.IsActive, i.Name }).ToListAsync(cancellationToken);
        if (found.Count != itemIds.Count)
        {
            throw new InvalidOperationException("One of the items was not found.");
        }

        if (found.FirstOrDefault(i => !i.IsActive) is { } inactive)
        {
            throw new InvalidOperationException($"{inactive.Name} is inactive. Restore it before ordering it.");
        }

        if (fields.Lines.Any(l => l.Packs <= 0m || l.UnitsPerPack <= 0m))
        {
            throw new InvalidOperationException("Enter the packs and the units in a pack for every line.");
        }
    }

    public static async Task<int> NextNumberAsync(WTFDbContext db, CancellationToken cancellationToken) =>
        (await db.PurchaseOrders.MaxAsync(o => (int?)o.PoNumber, cancellationToken) ?? 0) + 1;

    public static PurchaseOrderLine ToLine(PurchaseOrderLineRequest line) => new()
    {
        ItemId = line.ItemId,
        PackName = ItemValidation.NormalizeOptional(line.PackName),
        UnitsPerPack = line.UnitsPerPack,
        PackPrice = line.PackPrice,
        PacksOrdered = line.Packs
    };
}

public class CreatePurchaseOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreatePurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(CreatePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        await PurchaseOrderRules.ValidateAsync(db, request.Fields, true, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var order = new PurchaseOrder
        {
            PoNumber = await PurchaseOrderRules.NextNumberAsync(db, cancellationToken),
            SupplierId = request.Fields.SupplierId,
            Status = PurchaseOrderStatuses.Draft,
            ExpectedOn = request.Fields.ExpectedOn,
            Note = ItemValidation.NormalizeOptional(request.Fields.Note),
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            PurchaseOrderLines = [.. request.Fields.Lines.Select(PurchaseOrderRules.ToLine)]
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await auditService.LogAsync(
            AuditAction.PurchaseOrderCreated,
            AuditEntityType.PurchaseOrder,
            order.Id.ToString(),
            newValues: new { order.PoNumber, Lines = order.PurchaseOrderLines.Count },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await PurchaseOrderMapping.LoadAsync(db, order.Id, cancellationToken))!;
    }
}

public class CreatePurchaseOrderFromReorderHandler(
    WTFDbContext db,
    IMediator mediator) : IRequestHandler<CreatePurchaseOrderFromReorderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(CreatePurchaseOrderFromReorderCommand request, CancellationToken cancellationToken)
    {
        var list = await new GetReorderListHandler(db).Handle(new GetReorderListQuery(), cancellationToken);
        var group = list.Groups.FirstOrDefault(g => g.SupplierId == request.SupplierId)
            ?? throw new InvalidOperationException("Nothing is below par for this supplier.");

        var fields = new PurchaseOrderFields
        {
            SupplierId = request.SupplierId,
            Lines =
            [
                .. group.Lines.Select(l => new PurchaseOrderLineRequest
                {
                    ItemId = l.ItemId,
                    Packs = l.SuggestedPacks ?? l.SuggestedUnits,
                    UnitsPerPack = l.UnitsPerPack ?? 1m,
                    PackPrice = l.PackPrice,
                    PackName = l.PackName
                })
            ]
        };

        return await mediator.Send(new CreatePurchaseOrderCommand(fields), cancellationToken);
    }
}

public class UpdatePurchaseOrderHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdatePurchaseOrderCommand, PurchaseOrderDto?>
{
    public async Task<PurchaseOrderDto?> Handle(UpdatePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await db.PurchaseOrders.Include(o => o.PurchaseOrderLines).FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        if (order.Status != PurchaseOrderStatuses.Draft)
        {
            throw new InvalidOperationException("Only a draft order can be changed.");
        }

        await PurchaseOrderRules.ValidateAsync(db, request.Fields, true, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        db.PurchaseOrderLines.RemoveRange(order.PurchaseOrderLines);
        order.SupplierId = request.Fields.SupplierId;
        order.ExpectedOn = request.Fields.ExpectedOn;
        order.Note = ItemValidation.NormalizeOptional(request.Fields.Note);
        order.PurchaseOrderLines = [.. request.Fields.Lines.Select(PurchaseOrderRules.ToLine)];
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.PurchaseOrderUpdated,
            AuditEntityType.PurchaseOrder,
            order.Id.ToString(),
            newValues: new { order.PoNumber, Lines = order.PurchaseOrderLines.Count },
            userId: userId,
            cancellationToken: cancellationToken);

        return await PurchaseOrderMapping.LoadAsync(db, order.Id, cancellationToken);
    }
}

public class SetPurchaseOrderStatusHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetPurchaseOrderStatusCommand, PurchaseOrderDto?>
{
    public const string Send = "send";
    public const string Cancel = "cancel";
    public const string Close = "close";

    public async Task<PurchaseOrderDto?> Handle(SetPurchaseOrderStatusCommand request, CancellationToken cancellationToken)
    {
        var order = await db.PurchaseOrders.Include(o => o.PurchaseOrderLines).FirstOrDefaultAsync(o => o.Id == request.Id, cancellationToken);
        if (order is null)
        {
            return null;
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        AuditAction action;
        switch (request.Action)
        {
            case Send:
                if (order.Status != PurchaseOrderStatuses.Draft)
                {
                    throw new InvalidOperationException("Only a draft order can be sent.");
                }

                if (order.PurchaseOrderLines.Count == 0)
                {
                    throw new InvalidOperationException("Add at least one item to the order.");
                }

                order.Status = PurchaseOrderStatuses.Sent;
                order.SentAt = now;
                order.SentBy = userId;
                action = AuditAction.PurchaseOrderSent;
                break;
            case Cancel:
                if (order.Status is not (PurchaseOrderStatuses.Draft or PurchaseOrderStatuses.Sent))
                {
                    throw new InvalidOperationException("An order that has received goods cannot be cancelled. Close it instead.");
                }

                order.Status = PurchaseOrderStatuses.Cancelled;
                order.ClosedAt = now;
                order.ClosedBy = userId;
                action = AuditAction.PurchaseOrderCancelled;
                break;
            case Close:
                if (order.Status != PurchaseOrderStatuses.PartlyReceived)
                {
                    throw new InvalidOperationException("Only an order that is partly received can be closed.");
                }

                order.Status = PurchaseOrderStatuses.Received;
                order.ClosedAt = now;
                order.ClosedBy = userId;
                action = AuditAction.PurchaseOrderClosed;
                break;
            default:
                throw new InvalidOperationException("Unknown action.");
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(
            action,
            AuditEntityType.PurchaseOrder,
            order.Id.ToString(),
            newValues: new { order.PoNumber, order.Status },
            userId: userId,
            cancellationToken: cancellationToken);

        return await PurchaseOrderMapping.LoadAsync(db, order.Id, cancellationToken);
    }
}
