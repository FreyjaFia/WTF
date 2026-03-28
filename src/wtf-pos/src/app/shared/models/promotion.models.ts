export enum PromotionTypeEnum {
  FixedBundle = 1,
  MixMatch = 2,
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
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
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
}

export interface PromotionCartAddOnLineDto {
  addOnProductId: string;
  quantity: number;
}

export interface PromotionCartLineDto {
  lineId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  addOns: PromotionCartAddOnLineDto[];
  isPromoLine: boolean;
  isFreeItem: boolean;
  bundleParentId?: string | null;
  triggerLineId?: string | null;
  promotionId?: string | null;
  isLocked: boolean;
}

export interface EvaluatePromotionsRequestDto {
  lines: PromotionCartLineDto[];
  evaluatedAtUtc?: string | null;
}

export interface EvaluatePromotionsResponseDto {
  lines: PromotionCartLineDto[];
}

export interface PromotionImageDto {
  promotionId: string;
  imageUrl?: string | null;
}
