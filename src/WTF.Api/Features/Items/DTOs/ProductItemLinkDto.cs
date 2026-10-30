using System.ComponentModel.DataAnnotations;

namespace WTF.Api.Features.Items.DTOs;

public record ProductItemLinkDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string ProductCode,
    Guid ItemId,
    decimal QuantityPerSale,
    bool IsActive,
    bool ProductIsActive = true,
    decimal AllowancePercent = 0m);

public record ProductItemLinkAssignmentDto(
    Guid ProductId,
    [Range(0.001, 999999.999)]
    decimal QuantityPerSale,
    bool IsActive = true,
    [Range(0, 100)]
    decimal AllowancePercent = 0m);
