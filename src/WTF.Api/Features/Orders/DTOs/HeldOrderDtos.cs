namespace WTF.Api.Features.Orders.DTOs;

public record HeldOrderRowDto(
    Guid Id,
    int OrderNumber,
    DateTime CreatedAt,
    Guid CashierId,
    string CashierName,
    string? CustomerName,
    decimal Amount,
    string ItemsText,
    List<string> ReasonCodes,
    List<string> Reasons,
    bool IsAged,
    int AgeDays,
    decimal SeniorPwdDiscount);

public record HeldOrdersDto(
    List<HeldOrderRowDto> Items,
    int TotalCount,
    decimal TotalAmount,
    int AgedCount,
    decimal AgedAmount,
    int AgedAfterDays);

public record BulkApproveItemDto(Guid Id, int? OrderNumber, decimal Amount, string Outcome, string? Message = null);

public record BulkApproveResultDto(
    bool Preview,
    int Count,
    decimal TotalAmount,
    int SkippedCount,
    int FailedCount,
    bool Truncated,
    List<BulkApproveItemDto> Items);

public static class BulkApproveOutcomes
{
    public const string WouldApprove = "WouldApprove";
    public const string Approved = "Approved";
    public const string SkippedSeniorPwd = "SkippedSeniorPwd";
    public const string SkippedNotHeld = "SkippedNotHeld";
    public const string Failed = "Failed";
}
