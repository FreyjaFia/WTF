namespace WTF.Api.Features.Orders.DTOs;

public record OfflineSyncCodeModeDto(string Code, string Mode);

public record OfflineSyncPolicyDto(
    List<OfflineSyncCodeModeDto> Codes,
    decimal PriceTolerance,
    bool AutoApproveNotes,
    int AgedAfterDays,
    DateTime? UpdatedAt);
