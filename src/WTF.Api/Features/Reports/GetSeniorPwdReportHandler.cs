using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Reports.DTOs;
using WTF.Calculations.Sales;
using WTF.Calculations.Time;
using WTF.Domain.Data;

namespace WTF.Api.Features.Reports;

public sealed record GetSeniorPwdReportQuery : IRequest<List<SeniorPwdReportRowDto>>
{
    public DateTime? FromDate { get; init; }
    public DateTime? ToDate { get; init; }
    public OrderSourceEnum? Source { get; init; }
}

public sealed class GetSeniorPwdReportHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor) : IRequestHandler<GetSeniorPwdReportQuery, List<SeniorPwdReportRowDto>>
{
    public async Task<List<SeniorPwdReportRowDto>> Handle(GetSeniorPwdReportQuery request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var (fromUtc, toExclusiveUtc) = ReportDateRange.ToUtcRange(request.FromDate ?? default, request.ToDate ?? default, timeZone);
        byte? source = request.Source.HasValue ? (byte)request.Source.Value : null;

        var rows = await db.OrderSeniorPwdDiscounts
            .AsNoTracking()
            .Where(d =>
                d.Order.CreatedAt >= fromUtc
                && d.Order.CreatedAt < toExclusiveUtc
                && d.Order.StatusId == OrderStatuses.Completed
                && (source == null || d.Order.Source == source))
            .OrderBy(d => d.Order.CreatedAt)
            .ThenBy(d => d.Order.OrderNumber)
            .ThenBy(d => d.CreatedAt)
            .Select(d => new
            {
                d.Id,
                d.OrderId,
                d.Order.OrderNumber,
                d.Order.CreatedAt,
                d.Type,
                d.CustomerName,
                d.IdNumber,
                d.CoveredAmount,
                d.VatExemptAmount,
                d.DiscountAmount
            })
            .ToListAsync(cancellationToken);

        var fullId = WantsFullId();

        return rows
            .Select(r => new SeniorPwdReportRowDto(
                r.Id,
                r.OrderId,
                r.OrderNumber,
                ReportPeriods.LocalDateTime(r.CreatedAt, timeZone),
                (SeniorPwdTypeEnum)r.Type == SeniorPwdTypeEnum.Senior ? "Senior" : "PWD",
                r.CustomerName,
                fullId ? r.IdNumber : SeniorPwdOrders.MaskId(r.IdNumber),
                r.CoveredAmount,
                r.VatExemptAmount,
                r.DiscountAmount,
                r.CoveredAmount - r.VatExemptAmount - r.DiscountAmount))
            .ToList();
    }

    // The full ID only goes into a downloaded file, and only for someone who may generate reports.
    private bool WantsFullId()
    {
        var context = httpContextAccessor.HttpContext;
        if (context is null)
        {
            return false;
        }

        var accepts = context.Request.Headers.Accept.ToString();
        var isExport = accepts.Contains("spreadsheetml.sheet", StringComparison.OrdinalIgnoreCase)
            || accepts.Contains("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase)
            || accepts.Contains("application/pdf", StringComparison.OrdinalIgnoreCase);

        return isExport && PermissionChecks.HasAny(context.User, ["reports.generate"]);
    }
}
