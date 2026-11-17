using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Kitchen.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Kitchen;
using WTF.Calculations.Sales;
using WTF.Domain.Data;

namespace WTF.Api.Features.Kitchen;

public record GetKitchenBoardQuery(string? States = null, OrderSourceEnum? Source = null, string? Search = null) : IRequest<KitchenBoardDto>;

public class GetKitchenBoardHandler(WTFDbContext db) : IRequestHandler<GetKitchenBoardQuery, KitchenBoardDto>
{
    public async Task<KitchenBoardDto> Handle(GetKitchenBoardQuery request, CancellationToken cancellationToken)
    {
        var states = ParseStates(request.States);
        var now = DateTime.UtcNow;
        var timeZone = await KitchenBoardLoader.ShopTimeZoneAsync(db, cancellationToken);
        var startOfToday = RequestTimeZone.StartOfTodayUtc(timeZone, now);

        var open = states.Where(s => s != KitchenState.Served).Select(s => (byte)s).ToList();
        var wantServed = states.Contains(KitchenState.Served);
        var started = new byte[] { (byte)KitchenState.Preparing, (byte)KitchenState.Ready };

        var query = db.Orders.AsQueryable();
        if (request.Source.HasValue)
        {
            var source = (byte)request.Source.Value;
            query = query.Where(o => o.Source == source);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            var term = search.TrimStart('#').ToLower();
            query = query.Where(o => o.OrderNumber.ToString().Contains(term)
                || (o.Customer != null && o.Customer.FirstName.ToLower().Contains(term)));
        }

        var candidates = query.Where(o =>
            (o.KitchenStatus != null && open.Contains(o.KitchenStatus.Value)
                && (o.StatusId == OrderStatuses.Pending || o.StatusId == OrderStatuses.Completed))
            || (o.KitchenStatus != null && started.Contains(o.KitchenStatus.Value) && o.KitchenDismissedAt == null
                && (o.StatusId == OrderStatuses.Cancelled || o.StatusId == OrderStatuses.Refunded))
            || (wantServed && o.KitchenStatus == (byte)KitchenState.Served && o.KitchenServedAt >= startOfToday));

        var orders = await KitchenBoardLoader.MapAsync(db, candidates, timeZone, now, cancellationToken);

        var shown = orders
            .Where(o => o.IsStopMaking || (o.KitchenStatus == (byte)KitchenState.Served ? wantServed : states.Contains((KitchenState)o.KitchenStatus)))
            .OrderBy(o => o.KitchenStatus == (byte)KitchenState.Served ? 1 : 0)
            .ThenBy(o => o.KitchenStatus == (byte)KitchenState.Served ? 0 : o.CreatedAt.Ticks)
            .ThenByDescending(o => o.ServedAt)
            .ToList();

        return new KitchenBoardDto(shown, now);
    }

    private static List<KitchenState> ParseStates(string? text)
    {
        var parsed = (text ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => byte.TryParse(s, out var value) && Enum.IsDefined((KitchenState)value) ? (KitchenState?)(KitchenState)value : null)
            .Where(s => s.HasValue)
            .Select(s => s!.Value)
            .Distinct()
            .ToList();

        return parsed.Count > 0 ? parsed : [KitchenState.New, KitchenState.Preparing, KitchenState.Ready];
    }
}
