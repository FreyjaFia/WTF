namespace WTF.Api.Features.Dashboard.DTOs;

public record PaymentMethodBreakdownDto(
    string Name,
    int Count,
    decimal Total);
