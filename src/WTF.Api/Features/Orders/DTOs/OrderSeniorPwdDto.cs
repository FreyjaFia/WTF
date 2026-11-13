using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record OrderSeniorPwdDto(
    Guid Id,
    SeniorPwdTypeEnum Type,
    string IdNumber,
    string CustomerName,
    decimal CoveredAmount,
    decimal VatExemptAmount,
    decimal DiscountAmount);
