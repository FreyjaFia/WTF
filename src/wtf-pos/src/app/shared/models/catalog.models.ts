export interface CategoryLookupDto {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface SubCategoryLookupDto {
  id: number;
  name: string;
  categoryId?: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface AddOnTypeLookupDto {
  id: number;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
}

export interface CatalogLookupsDto {
  categories: CategoryLookupDto[];
  subCategories: SubCategoryLookupDto[];
  addOnTypes: AddOnTypeLookupDto[];
}

export interface SubCategorySetupDto extends SubCategoryLookupDto {
  productCount: number;
}

export interface CategorySetupDto extends CategoryLookupDto {
  productCount: number;
  subCategories: SubCategorySetupDto[];
}

export interface AddOnTypeSetupDto extends AddOnTypeLookupDto {
  productCount: number;
}

export interface CatalogSetupDto {
  categories: CategorySetupDto[];
  unassignedSubCategories: SubCategorySetupDto[];
  addOnTypes: AddOnTypeSetupDto[];
}

export interface SaveCategoryRequest {
  name: string;
  sortOrder: number;
}

export interface SaveSubCategoryRequest {
  name: string;
  categoryId: number;
  sortOrder: number;
}

export interface SaveAddOnTypeRequest {
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
}

// Ids the app treats specially. Everything else comes from the catalog lists.
export const SYSTEM_CATALOG_IDS = {
  sizeAddOnType: 1,
  extraAddOnType: 4,
  retailSubCategory: 4,
  otherCategory: 4,
} as const;
