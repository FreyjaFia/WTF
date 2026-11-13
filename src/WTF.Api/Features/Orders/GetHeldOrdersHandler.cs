using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetHeldOrdersQuery(HeldOrderFilter Filter) : IRequest<HeldOrdersDto>;

public class GetHeldOrdersHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<GetHeldOrdersQuery, HeldOrdersDto>
{
    public async Task<HeldOrdersDto> Handle(GetHeldOrdersQuery request, CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var agedAfterDays = await HeldOrderAging.AgedAfterDaysAsync(db, cancellationToken);

        var matching = HeldOrderQueries.Matching(db, request.Filter, timeZone, nowUtc, agedAfterDays);
        var orders = await matching
            .AsNoTracking()
            .Include(o => o.CreatedByNavigation)
            .Include(o => o.Customer)
            .Include(o => o.OrderItems.Where(oi => oi.ParentOrderItemId == null))
                .ThenInclude(oi => oi.Product)
            .OrderBy(o => o.CreatedAt)
            .Take(HeldOrderQueries.MaxOrders)
            .ToListAsync(cancellationToken);

        var reasons = await HeldOrderQueries.LoadReasonsAsync(db, [.. orders.Select(o => o.Id)], cancellationToken);

        var rows = orders.Select(o =>
        {
            reasons.TryGetValue(o.Id, out var orderReasons);
            var holds = (orderReasons ?? []).Where(r => r.Severity == (byte)ReviewSeverityEnum.Hold).ToList();
            var texts = holds.Count > 0
                ? holds.Select(r => r.Text).Distinct().ToList()
                : [.. (o.ReviewReasons ?? string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)];
            var parents = o.OrderItems.Where(oi => oi.ParentOrderItemId == null).ToList();

            return new HeldOrderRowDto(
                o.Id,
                o.OrderNumber,
                o.CreatedAt,
                o.CreatedBy,
                $"{o.CreatedByNavigation.FirstName} {o.CreatedByNavigation.LastName}".Trim(),
                o.Customer == null ? null : $"{o.Customer.FirstName} {o.Customer.LastName}".Trim(),
                o.QuotedTotal ?? 0m,
                string.Join(", ", parents.Select(p => $"{p.Quantity} x {p.Product.Name}")),
                HeldOrderQueries.HoldCodes(orderReasons),
                texts,
                HeldOrderRules.IsAged(o.CreatedAt, nowUtc, agedAfterDays),
                HeldOrderRules.AgeDays(o.CreatedAt, nowUtc),
                parents.Sum(p => p.SeniorPwdDiscount ?? 0m));
        }).ToList();

        var summary = HeldOrderRules.Summarize(rows.Select(r => new HeldOrderFigure(r.CreatedAt, r.Amount)), nowUtc, agedAfterDays);
        return new HeldOrdersDto(rows, summary.Count, summary.Amount, summary.AgedCount, summary.AgedAmount, agedAfterDays);
    }
}
