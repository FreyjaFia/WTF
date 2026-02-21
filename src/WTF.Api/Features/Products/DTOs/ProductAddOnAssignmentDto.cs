using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Products.DTOs;

public record ProductAddOnAssignmentDto(Guid AddOnId, AddOnTypeEnum AddOnType);
