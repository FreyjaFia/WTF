export enum ProductCategoryEnum {
  Drink = 1,
  Food = 2,
  Dessert = 3,
  Other = 4,
}

export enum ProductSubCategoryEnum {
  Coffee = 1,
  NonCoffee = 2,
  Snacks = 3,
}

export const PRODUCT_SUB_CATEGORY_LABELS: Record<ProductSubCategoryEnum, string> = {
  [ProductSubCategoryEnum.Coffee]: 'Coffee',
  [ProductSubCategoryEnum.NonCoffee]: 'Non-Coffee',
  [ProductSubCategoryEnum.Snacks]: 'Snacks',
};

export enum AddOnTypeEnum {
  Size = 1,
  Flavor = 2,
  Topping = 3,
  Extra = 4,
  Sauce = 5,
}

export const ADD_ON_TYPE_ORDER: Record<AddOnTypeEnum, number> = {
  [AddOnTypeEnum.Size]: 0,
  [AddOnTypeEnum.Flavor]: 1,
  [AddOnTypeEnum.Sauce]: 2,
  [AddOnTypeEnum.Topping]: 3,
  [AddOnTypeEnum.Extra]: 4,
};

export interface ProductPriceHistoryDto {
  id: string;
  productId: string;
  oldPrice?: number | null;
  newPrice: number;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string | null;
}

export interface ProductDto {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: number;
  category: ProductCategoryEnum;
  subCategory?: ProductSubCategoryEnum | null;
  isAddOn: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  imageUrl?: string | null;
  priceHistory: ProductPriceHistoryDto[];
  addOnCount: number;
  overridePrice?: number | null;
}

export interface ProductListDto {
  products: ProductDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateProductDto {
  name: string;
  code: string;
  description?: string | null;
  price: number;
  category: ProductCategoryEnum;
  subCategory?: ProductSubCategoryEnum | null;
  isAddOn: boolean;
  isActive: boolean;
}

export interface UpdateProductDto {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: number;
  category: ProductCategoryEnum;
  subCategory?: ProductSubCategoryEnum | null;
  isAddOn: boolean;
  isActive: boolean;
}

export interface ProductAddOnAssignmentDto {
  addOnId: string;
  addOnType: AddOnTypeEnum;
}

export interface AddOnProductAssignmentDto {
  productId: string;
  addOnType: AddOnTypeEnum;
}

export interface AddOnGroupDto {
  type: AddOnTypeEnum;
  displayName: string;
  options: ProductDto[];
}

export interface ProductAddOnPriceOverrideDto {
  productId: string;
  addOnId: string;
  price: number;
  isActive: boolean;
}

export interface CreateProductAddOnPriceOverrideDto {
  productId: string;
  addOnId: string;
  price: number;
  isActive?: boolean;
}

export interface UpdateProductAddOnPriceOverrideDto {
  productId: string;
  addOnId: string;
  price: number;
  isActive?: boolean;
}
