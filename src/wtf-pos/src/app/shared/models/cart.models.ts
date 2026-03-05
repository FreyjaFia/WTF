import { AddOnTypeEnum } from './product.models';
import { PromotionTypeEnum } from './promotion.models';

export interface CartAddOnDto {
  addOnId: string;
  name: string;
  price: number;
  addOnType?: AddOnTypeEnum;
}

export interface CartBundleItemDto {
  productId: string;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string | null;
  addOns?: CartAddOnDto[];
}

export interface CartItemDto {
  productId: string;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string | null;
  addOns?: CartAddOnDto[];
  specialInstructions?: string | null;
  bundlePromotionId?: string | null;
  bundlePromotionName?: string | null;
  bundlePromotionTypeId?: PromotionTypeEnum | null;
  bundleRequiredSelectionCount?: number | null;
  bundleMaxSelectionPerOption?: number | null;
  bundleItems?: CartBundleItemDto[];
}
