namespace WTF.Api.Features.Customers.DTOs;

public record CustomerDto(Guid Id, string FirstName, string LastName, string? Address, bool IsActive, string? ImageUrl);
