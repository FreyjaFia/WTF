namespace WTF.Api.Features.Orders.DTOs;

public record OrderReviewReasonDto(
    string Code,
    string Severity,
    string Text,
    int? LineIndex = null,
    string? ExpectedValue = null,
    string? QuotedValue = null);
