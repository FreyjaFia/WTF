using WTF.Api.Features.Products.Enums;

namespace WTF.Api.Features.Products.DTOs;

public record AddOnGroupDto(AddOnTypeEnum Type, string DisplayName, List<ProductDto> Options);
