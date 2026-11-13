using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

public record OfflineReason(
    string Code,
    ReviewSeverityEnum Severity,
    string Text,
    int? LineIndex = null,
    string? ExpectedValue = null,
    string? QuotedValue = null,
    decimal? UnitPriceDifference = null)
{
    public static OfflineReason Hold(string code, string text, int? lineIndex = null, string? expected = null, string? quoted = null, decimal? unitPriceDifference = null)
    {
        return new OfflineReason(code, ReviewSeverityEnum.Hold, text, lineIndex, expected, quoted, unitPriceDifference);
    }

    public static OfflineReason Note(string code, string text, int? lineIndex = null, string? expected = null, string? quoted = null)
    {
        return new OfflineReason(code, ReviewSeverityEnum.Note, text, lineIndex, expected, quoted);
    }
}

public static class OfflineReasonCodes
{
    public const string PriceChanged = "PriceChanged";
    public const string AddOnPriceChanged = "AddOnPriceChanged";
    public const string ProductInactive = "ProductInactive";
    public const string PromotionEnded = "PromotionEnded";
    public const string PromotionOverLimit = "PromotionOverLimit";
    public const string BundleChanged = "BundleChanged";
    public const string CustomerInactive = "CustomerInactive";
    public const string StockShortfall = "StockShortfall";
    public const string UnknownProduct = "UnknownProduct";
    public const string SeniorPwdSettingsChanged = "SeniorPwdSettingsChanged";
    public const string SeniorPwdDisabled = "SeniorPwdDisabled";
    public const string SeniorPwdIdMissing = "SeniorPwdIdMissing";
    public const string SeniorPwdOnPromotion = "SeniorPwdOnPromotion";
    public const string SeniorPwdIdRepeated = "SeniorPwdIdRepeated";
    public const string SeniorPwdPermissionLost = "SeniorPwdPermissionLost";
}

internal static class OrderReviewReasons
{
    private const int TextMaxLength = 300;

    public static OrderReviewReason ToRow(Order order, OfflineReason reason, int sortOrder)
    {
        return new OrderReviewReason
        {
            Order = order,
            SortOrder = sortOrder,
            LineIndex = reason.LineIndex,
            Code = reason.Code,
            Severity = (byte)reason.Severity,
            ExpectedValue = reason.ExpectedValue,
            QuotedValue = reason.QuotedValue,
            Text = reason.Text.Length <= TextMaxLength ? reason.Text : string.Concat(reason.Text.AsSpan(0, TextMaxLength - 1), "…")
        };
    }

    public static OrderReviewReasonDto ToDto(OfflineReason reason)
    {
        return new OrderReviewReasonDto(
            reason.Code, reason.Severity.ToString(), reason.Text, reason.LineIndex, reason.ExpectedValue, reason.QuotedValue);
    }

    public static OrderReviewReasonDto ToDto(OrderReviewReason row)
    {
        return new OrderReviewReasonDto(
            row.Code, ((ReviewSeverityEnum)row.Severity).ToString(), row.Text, row.LineIndex, row.ExpectedValue, row.QuotedValue);
    }

    public static async Task<List<OrderReviewReasonDto>> LoadAsync(WTFDbContext db, Guid orderId, CancellationToken cancellationToken)
    {
        var rows = await db.OrderReviewReasons
            .AsNoTracking()
            .Where(r => r.OrderId == orderId)
            .OrderBy(r => r.SortOrder)
            .ToListAsync(cancellationToken);

        return [.. rows.Select(ToDto)];
    }

}
