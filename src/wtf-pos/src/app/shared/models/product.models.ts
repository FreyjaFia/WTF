import type { PriceHistoryEntryDto } from './price-history.models';

export function formatSubCategoryName(name: string | null | undefined): string {
  return name ? name.replace(/^Non(?=[A-Z])/, 'Non-') : '';
}

export const ADD_ON_TYPE_ORDER: Record<number, number> = {
  1: 0,
  2: 1,
  5: 2,
  3: 3,
  4: 4,
};

export function applyAddOnTypeOrder(types: { id: number; sortOrder: number }[]): void {
  const sorted = [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const key of Object.keys(ADD_ON_TYPE_ORDER)) {
    delete ADD_ON_TYPE_ORDER[Number(key)];
  }

  sorted.forEach((type, index) => {
    ADD_ON_TYPE_ORDER[type.id] = index;
  });
}

export interface ProductPriceHistoryDto extends PriceHistoryEntryDto {
  productId: string;
}

export interface ProductDto {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: number;
  category: number;
  subCategory?: number | null;
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
  category: number;
  subCategory?: number | null;
  isAddOn: boolean;
  isActive: boolean;
}

export interface UpdateProductDto {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: number;
  category: number;
  subCategory?: number | null;
  isAddOn: boolean;
  isActive: boolean;
}

export interface ProductAddOnAssignmentDto {
  addOnId: string;
  addOnType: number;
}

export interface AddOnProductAssignmentDto {
  productId: string;
  addOnType: number;
}

export interface AddOnGroupDto {
  type: number;
  displayName: string;
  options: ProductDto[];
  isRequired?: boolean;
  minSelect?: number;
  maxSelect?: number;
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
