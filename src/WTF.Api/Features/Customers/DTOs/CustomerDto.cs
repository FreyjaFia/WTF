namespace WTF.Api.Features.Customers.DTOs;

public record CustomerDto(
    Guid Id,
    string FirstName,
    string LastName,
    string? Address,
    bool IsActive,
    DateTime CreatedAt,
    Guid CreatedBy,
    DateTime? UpdatedAt,
    Guid? UpdatedBy,
    string? ImageUrl
);
