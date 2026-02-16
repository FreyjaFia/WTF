using WTF.Contracts.Products.Enums;

namespace WTF.Contracts.Products;

public record AddOnProductAssignmentDto(
    Guid ProductId,
    AddOnTypeEnum AddOnType
);
