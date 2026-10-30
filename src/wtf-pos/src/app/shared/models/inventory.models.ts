import type { PriceHistoryEntryDto } from './price-history.models';

export interface ItemDto {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitName: string;
  stockUnitName?: string | null;
  unitsPerStockUnit?: number | null;
  currentQuantity: number;
  costPrice?: number | null;
  averageCost?: number | null;
  yieldPercent?: number;
  usableCost?: number | null;
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  isActive: boolean;
  allowNegativeStock: boolean;
  wasteApprovalLimit?: number | null;
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  priceHistory: ItemPriceHistoryDto[];
  productLinks: ProductItemLinkDto[];
  recentMovements: StockMovementDto[];
}

export interface ItemPriceHistoryDto extends PriceHistoryEntryDto {
  itemId: string;
}

export interface ProductItemLinkDto {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  itemId: string;
  quantityPerSale: number;
  allowancePercent?: number;
  isActive: boolean;
  productIsActive?: boolean;
}

export interface ProductItemLinkAssignmentDto {
  productId: string;
  quantityPerSale: number;
  allowancePercent?: number;
  isActive?: boolean;
}

export interface RecipeCostLineDto {
  linkId: string;
  itemId: string;
  itemName: string;
  unitName: string;
  quantityPerSale: number;
  allowancePercent: number;
  effectiveQuantity: number;
  unitCost: number | null;
  lineCost: number | null;
}

export interface RecipeCostDto {
  productId: string;
  productName: string;
  price: number;
  lines: RecipeCostLineDto[];
  totalCost: number;
  unknownCostCount: number;
  margin: number;
  marginPercent: number | null;
}

export interface StockMovementDto {
  id: string;
  itemId: string;
  movementType: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  productId?: string | null;
  productName?: string | null;
  orderNumber?: number | null;
}

export interface PagedStockMovementsDto {
  items: StockMovementDto[];
  totalCount: number;
}

export interface OrderStockMovementDto {
  id: string;
  itemId: string;
  itemName: string;
  unitName: string;
  productId?: string | null;
  productName?: string | null;
  movementType: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  notes?: string | null;
  createdAt: string;
}

export interface CreateItemDto {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitName: string;
  stockUnitName?: string | null;
  unitsPerStockUnit?: number | null;
  startingQuantity: number;
  costPrice?: number | null;
  yieldPercent?: number | null;
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  allowNegativeStock?: boolean;
  wasteApprovalLimit?: number | null;
  isActive: boolean;
}

export interface UpdateItemDto {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitName: string;
  stockUnitName?: string | null;
  unitsPerStockUnit?: number | null;
  costPrice?: number | null;
  yieldPercent?: number | null;
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  allowNegativeStock?: boolean;
  wasteApprovalLimit?: number | null;
  isActive: boolean;
}

export interface AddItemStockDto {
  itemId: string;
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
}

export const STOCK_ADJUSTMENT_REASONS = [
  'Count correction',
  'Damaged or spoiled',
  'Lost',
  'Other',
] as const;

export interface AdjustItemStockDto {
  itemId: string;
  countedQuantity?: number | null;
  expectedQuantity?: number | null;
  quantityChange?: number | null;
  reason: string;
  notes?: string | null;
}

export type ProductCoverageStatus = 'Covered' | 'Partial' | 'Missing';

export interface ProductCoverageDto {
  productId: string;
  name: string;
  code: string;
  status: ProductCoverageStatus;
  missingOptions: string[];
}

export interface StockCoverageDto {
  covered: number;
  partial: number;
  missing: number;
  products: ProductCoverageDto[];
}

export type StockAttentionLevel = 'Warning' | 'Critical' | 'OutOfStock';

export interface StockAttentionItemDto {
  id: string;
  name: string;
  unitName: string;
  currentQuantity: number;
  warningQuantity: number | null;
  criticalQuantity: number | null;
  status: StockAttentionLevel;
  allowNegativeStock: boolean;
  productCount: number;
  salesCovered: number;
}

export interface StockAttentionDto {
  items: StockAttentionItemDto[];
  outCount: number;
  criticalCount: number;
  warningCount: number;
  totalCount: number;
}

export interface StockLimitItemDto {
  id: string;
  name: string;
  unitName: string;
  balance: number;
}

export interface StockLimitLinkDto {
  productId: string;
  itemId: string;
  quantityPerSale: number;
}

export interface PosStockLimitsDto {
  items: StockLimitItemDto[];
  links: StockLimitLinkDto[];
  asOf: string;
}

export interface AlertRecipientDto {
  userId: string;
  name: string;
  role: string;
}

export interface ItemAlertRecipientsDto {
  selectedUserIds: string[];
  candidates: AlertRecipientDto[];
  defaultDescription: string;
}
