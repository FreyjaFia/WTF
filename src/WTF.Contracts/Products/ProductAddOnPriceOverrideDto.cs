namespace WTF.Contracts.Products;

public record ProductAddOnPriceOverrideDto(
    Guid ProductId,
    Guid AddOnId,
    decimal Price,
    bool IsActive
);
