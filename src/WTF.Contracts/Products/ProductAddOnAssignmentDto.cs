using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record ProductAddOnAssignmentDto(
    Guid AddOnId,
    AddOnTypeEnum AddOnType
);
