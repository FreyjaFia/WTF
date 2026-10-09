using System.ComponentModel.DataAnnotations;

namespace WTF.Api.Features.Items.DTOs;

public record ProductItemLinkDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string ProductCode,
    Guid ItemId,
    decimal QuantityPerSale,
    bool IsActive);

public record ProductItemLinkAssignmentDto(
    Guid ProductId,
    [Range(0.001, 999999.999)]
    decimal QuantityPerSale,
    bool IsActive = true);
