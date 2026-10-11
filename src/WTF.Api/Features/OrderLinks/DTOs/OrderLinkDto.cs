namespace WTF.Api.Features.OrderLinks.DTOs;

public record OrderLinkDto(
    Guid Id,
    string Token,
    string Status,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? ExpiresAt,
    DateTime? RevokedAt,
    DateTime? LastUsedAt,
    int OrdersCount = 0
);

public record OrderingLinkAccessDto(bool AllowOrderingLink, int RevokedLinks);
