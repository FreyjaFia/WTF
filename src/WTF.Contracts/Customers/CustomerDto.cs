namespace WTF.Contracts.Customers;

public record CustomerDto(
    Guid Id,
    string FirstName,
    string LastName,
    string? Address,
    bool IsActive
);
