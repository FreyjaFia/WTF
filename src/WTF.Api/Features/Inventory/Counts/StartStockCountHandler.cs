using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Items;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Counts;

public record StartStockCountCommand : IRequest<StockCountDto>
{
    [Required]
    [StringLength(100)]
    public string Name { get; init; } = string.Empty;

    public bool IsBlind { get; init; }

    [StringLength(500)]
    public string? Note { get; init; }

    [MaxLength(2000)]
    public List<Guid>? ItemIds { get; init; }
}

public class StartStockCountHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<StartStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(StartStockCountCommand request, CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        if (name.Length == 0)
        {
            throw new InvalidOperationException("Give the count a name.");
        }

        var wanted = request.ItemIds?.Distinct().ToList();
        var itemIds = await db.Items
            .AsNoTracking()
            .Where(i => i.IsActive && (wanted == null || wanted.Count == 0 || wanted.Contains(i.Id)))
            .Select(i => i.Id)
            .ToListAsync(cancellationToken);
        if (itemIds.Count == 0)
        {
            throw new InvalidOperationException("There are no active items to count.");
        }

        if (wanted is { Count: > 0 } && itemIds.Count != wanted.Count)
        {
            throw new InvalidOperationException("One or more of the chosen items do not exist or are inactive.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var count = new StockCount
        {
            Name = name,
            IsBlind = request.IsBlind,
            Note = ItemValidation.NormalizeOptional(request.Note),
            Status = StockCountStatuses.Open,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId,
            StockCountLines = itemIds.Select(id => new StockCountLine { ItemId = id }).ToList()
        };

        db.StockCounts.Add(count);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.StockCountStarted,
            AuditEntityType.StockCount,
            count.Id.ToString(),
            newValues: new { count.Name, count.IsBlind, Items = itemIds.Count },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await StockCountMapping.LoadAsync(db, count.Id, cancellationToken))!;
    }
}
