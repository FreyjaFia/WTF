export enum PromotionTypeEnum {
  FixedBundle = 1,
  MixMatch = 2,
  DiscountedProduct = 3,
}

/** When a promotion runs and how often it was used: the API's `PromotionScheduleDto`. */
export interface PromotionScheduleDto {
  /** Bit mask of the days, Sunday = 1 ... Saturday = 64. Missing means every day. */
  daysOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  maxRedemptions: number | null;
  redemptions: number;
}

export interface PromotionListItemDto {
  id: string;
  name: string;
  typeId: PromotionTypeEnum;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  imageUrl?: string | null;
  bundlePrice?: number | null;
  fixedPrice?: number | null;
  percentOff?: number | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  schedule?: PromotionScheduleDto | null;
}

export interface FixedBundleItemAddOnDto {
  id?: string | null;
  addOnProductId: string;
  quantity: number;
}

export interface FixedBundleItemDto {
  id?: string | null;
  productId: string;
  quantity: number;
  addOns: FixedBundleItemAddOnDto[];
}

export interface FixedBundlePromotionDto {
  id: string;
  name: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  imageUrl?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  bundlePrice: number;
  items: FixedBundleItemDto[];
  schedule?: PromotionScheduleDto | null;
}

export interface MixMatchItemAddOnDto {
  id?: string | null;
  addOnProductId: string;
  quantity: number;
}

export interface MixMatchItemDto {
  id?: string | null;
  productId: string;
  addOns: MixMatchItemAddOnDto[];
}

export interface MixMatchPromotionDto {
  id: string;
  name: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  imageUrl?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  requiredQuantity: number;
  maxSelectionsPerOrder: number | null;
  bundlePrice: number;
  items: MixMatchItemDto[];
  schedule?: PromotionScheduleDto | null;
}

export interface DiscountedProductAddOnDto {
  id?: string | null;
  addOnProductId: string;
  quantity: number;
}

export interface DiscountedProductItemDto {
  id?: string | null;
  productId: string;
  fixedPrice?: number | null;
  percentOff?: number | null;
  addOns: DiscountedProductAddOnDto[];
}

export interface DiscountedProductPromotionDto {
  id: string;
  name: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  imageUrl?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  items: DiscountedProductItemDto[];
  schedule?: PromotionScheduleDto | null;
}

/** Every active bundle with its items, for whoever sells at the POS. */
export interface PosBundlesDto {
  fixedBundles: FixedBundlePromotionDto[];
  mixMatch: MixMatchPromotionDto[];
}

export interface PromotionImageDto {
  promotionId: string;
  imageUrl?: string | null;
}
