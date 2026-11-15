using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Services;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal static class SeniorPwdAudit
{
    public static object AuditValues(OrderSeniorPwdDiscount row) => new
    {
        Type = (SeniorPwdTypeEnum)row.Type,
        Id = SeniorPwdMapping.MaskId(row.IdNumber),
        row.CustomerName,
        row.CoveredAmount,
        row.VatExemptAmount,
        row.DiscountAmount
    };

    public static string Signature(IEnumerable<OrderSeniorPwdDiscount> rows) =>
        string.Join("|", rows
            .Select(r => $"{r.Type}:{r.IdNumber}:{r.CustomerName}:{r.CoveredAmount}:{r.VatExemptAmount}:{r.DiscountAmount}")
            .Order());

    public static async Task LogChangesAsync(
        IAuditService auditService,
        Order order,
        IReadOnlyCollection<OrderSeniorPwdDiscount> before,
        IReadOnlyCollection<OrderSeniorPwdDiscount> after,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (Signature(before) == Signature(after))
        {
            return;
        }

        foreach (var row in before)
        {
            await auditService.LogAsync(
                AuditAction.SeniorPwdDiscountRemoved,
                AuditEntityType.Order,
                order.Id.ToString(),
                oldValues: new { order.OrderNumber, Person = AuditValues(row) },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        foreach (var row in after)
        {
            await auditService.LogAsync(
                AuditAction.SeniorPwdDiscountApplied,
                AuditEntityType.Order,
                order.Id.ToString(),
                newValues: new { order.OrderNumber, Person = AuditValues(row) },
                userId: userId,
                cancellationToken: cancellationToken);
        }
    }

    public static List<OrderSeniorPwdDiscount> Snapshot(IEnumerable<OrderSeniorPwdDiscount> rows) =>
        rows.Select(row => new OrderSeniorPwdDiscount
        {
            Id = row.Id,
            OrderId = row.OrderId,
            Type = row.Type,
            IdNumber = row.IdNumber,
            CustomerName = row.CustomerName,
            CoveredAmount = row.CoveredAmount,
            VatExemptAmount = row.VatExemptAmount,
            DiscountAmount = row.DiscountAmount,
            RecordedBy = row.RecordedBy,
            CreatedAt = row.CreatedAt
        }).ToList();
}
