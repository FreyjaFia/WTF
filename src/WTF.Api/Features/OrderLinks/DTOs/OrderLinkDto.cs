namespace WTF.Api.Features.OrderLinks.DTOs;

public record OrderLinkDto(
    Guid Id,
    string Token,
    string Status,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? ExpiresAt,
    DateTime? RevokedAt,
    DateTime? LastUsedAt
);

public record OrderingLinkAccessDto(bool AllowOrderingLink, int RevokedLinks);
