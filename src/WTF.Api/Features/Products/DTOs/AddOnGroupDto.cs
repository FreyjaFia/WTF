
namespace WTF.Api.Features.Products.DTOs;

public record AddOnGroupDto(int Type, string DisplayName, List<ProductDto> Options, bool IsRequired = false, int MinSelect = 0, int MaxSelect = 0);
