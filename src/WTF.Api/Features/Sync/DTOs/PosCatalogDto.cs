using WTF.Api.Features.Customers.DTOs;
using WTF.Api.Features.Products.DTOs;

namespace WTF.Api.Features.Sync.DTOs;

public record PosCatalogDto(
    List<ProductDto> Products,
    Dictionary<Guid, List<AddOnGroupDto>> AddOnsByProductId,
    List<CustomerDto> Customers,
    DateTime SyncedAt
);
