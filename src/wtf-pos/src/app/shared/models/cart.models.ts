import { PromotionTypeEnum } from './promotion.models';

export interface CartAddOnDto {
  addOnId: string;
  name: string;
  price: number;
  addOnType?: number;
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
  // The list price of one item when a promotion changed `price`; the breakdown starts from it.
  originalPrice?: number | null;
  promoLabel?: string | null;
  promoDiscount?: number | null;
  bundlePromotionId?: string | null;
  bundlePromotionName?: string | null;
  bundlePromotionTypeId?: PromotionTypeEnum | null;
  bundleRequiredSelectionCount?: number | null;
  bundleMaxSelectionPerOption?: number | null;
  bundleItems?: CartBundleItemDto[];
  // Position in the order's Senior / PWD persons when this line is covered for one of them.
  seniorPwdPersonIndex?: number | null;
  // What the Senior / PWD discount took off this line (VAT not charged plus the discount), for a saved order.
  seniorPwdReduction?: number | null;
}
