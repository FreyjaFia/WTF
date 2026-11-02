using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Api.Common.Extensions;
using WTF.Domain.Data;

namespace WTF.Api.Features.Inventory.Counts;

public record StockCountEntry(Guid ItemId, [property: Range(0, 999999.999)] decimal? CountedQuantity);

public record SaveStockCountLinesCommand : IRequest<StockCountDto?>
{
    public Guid CountId { get; init; }

    [Required]
    [MinLength(1)]
    [MaxLength(2000)]
    public List<StockCountEntry> Lines { get; init; } = [];
}

public class SaveStockCountLinesHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<SaveStockCountLinesCommand, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(SaveStockCountLinesCommand request, CancellationToken cancellationToken)
    {
        var count = await db.StockCounts
            .Include(c => c.StockCountLines)
            .FirstOrDefaultAsync(c => c.Id == request.CountId, cancellationToken);
        if (count is null)
        {
            return null;
        }

        if (count.Status != StockCountStatuses.Open)
        {
            throw new InvalidOperationException("This count is closed, so its numbers can no longer change.");
        }

        var entries = request.Lines.GroupBy(l => l.ItemId).Select(g => g.Last()).ToList();
        var lines = count.StockCountLines.ToDictionary(l => l.ItemId);
        if (entries.Any(e => !lines.ContainsKey(e.ItemId)))
        {
            throw new InvalidOperationException("One of the items is not part of this count.");
        }

        var entryIds = entries.Select(e => e.ItemId).ToList();
        var balances = await db.Items
            .AsNoTracking()
            .Where(i => entryIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, i => i.CurrentQuantity, cancellationToken);

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var now = DateTime.UtcNow;
        foreach (var entry in entries)
        {
            var line = lines[entry.ItemId];
            if (entry.CountedQuantity is null)
            {
                line.CountedQuantity = null;
                line.ExpectedQuantity = null;
                line.CountedAt = null;
                line.CountedBy = null;
                continue;
            }

            // What the system showed at the moment of counting: posting later applies counted minus this, so sales made in
            // between are not undone.
            line.CountedQuantity = entry.CountedQuantity;
            line.ExpectedQuantity = balances[entry.ItemId];
            line.CountedAt = now;
            line.CountedBy = userId;
        }

        await db.SaveChangesAsync(cancellationToken);
        return await StockCountMapping.LoadAsync(db, count.Id, cancellationToken);
    }
}
