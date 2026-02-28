using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetPaymentsReportQuery : IRequest<List<PaymentsReportRowDto>>
{
    public DateTime FromDate { get; init; }
    public DateTime ToDate { get; init; }
}

public sealed class GetPaymentsReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetPaymentsReportQuery, List<PaymentsReportRowDto>>
{
    public async Task<List<PaymentsReportRowDto>> Handle(GetPaymentsReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate, request.ToDate, timeZone);

        var grouped = await db.Orders
            .AsNoTracking()
            .Include(o => o.PaymentMethod)
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.Product)
            .Where(o =>
                o.CreatedAt >= fromUtc
                && o.CreatedAt < toExclusiveUtc
                && o.StatusId == (int)OrderStatusEnum.Completed)
            .GroupBy(o => o.PaymentMethod != null ? o.PaymentMethod.Name : "Unknown")
            .Select(g => new
            {
                PaymentMethod = g.Key,
                OrderCount = g.Count(),
                TotalAmount = g.Sum(o => o.OrderItems.Sum(oi => (oi.Price ?? oi.Product.Price) * oi.Quantity))
            })
            .OrderByDescending(r => r.TotalAmount)
            .ToListAsync(cancellationToken);

        var grandTotal = grouped.Sum(g => g.TotalAmount);

        return grouped
            .Select(row => new PaymentsReportRowDto(
                row.PaymentMethod,
                row.OrderCount,
                row.TotalAmount,
                grandTotal > 0 ? row.TotalAmount / grandTotal * 100 : 0m))
            .ToList();
    }
}
