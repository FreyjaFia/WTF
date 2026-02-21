using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Products.DTOs;

public record AddOnProductAssignmentDto(Guid ProductId, AddOnTypeEnum AddOnType);
