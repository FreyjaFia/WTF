namespace WTF.Api.Features.Catalog.DTOs;

public record CategoryDto(int Id, string Name, int SortOrder, bool IsActive, int ProductCount, List<SubCategoryDto> SubCategories);

public record SubCategoryDto(int Id, string Name, int? CategoryId, int SortOrder, bool IsActive, int ProductCount);

public record AddOnTypeDto(int Id, string Name, bool IsRequired, int MinSelect, int MaxSelect, int SortOrder, bool IsActive, int ProductCount);

public record CatalogSetupDto(List<CategoryDto> Categories, List<SubCategoryDto> UnassignedSubCategories, List<AddOnTypeDto> AddOnTypes);

public record CategoryLookupDto(int Id, string Name, int SortOrder, bool IsActive);

public record SubCategoryLookupDto(int Id, string Name, int? CategoryId, int SortOrder, bool IsActive);

public record AddOnTypeLookupDto(int Id, string Name, bool IsRequired, int MinSelect, int MaxSelect, int SortOrder, bool IsActive);

public record CatalogLookupsDto(List<CategoryLookupDto> Categories, List<SubCategoryLookupDto> SubCategories, List<AddOnTypeLookupDto> AddOnTypes);
