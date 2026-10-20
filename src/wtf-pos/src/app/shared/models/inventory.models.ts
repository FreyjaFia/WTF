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
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  isActive: boolean;
  allowNegativeStock: boolean;
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
  isActive: boolean;
}

export interface ProductItemLinkAssignmentDto {
  productId: string;
  quantityPerSale: number;
  isActive?: boolean;
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
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  allowNegativeStock?: boolean;
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
  warningQuantity?: number | null;
  criticalQuantity?: number | null;
  allowNegativeStock?: boolean;
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

export type StockAlertLevel = 'Warning' | 'Critical' | 'OutOfStock';

export interface StockNotificationDto {
  id: string;
  itemId: string;
  itemName: string;
  status: StockAlertLevel;
  quantity: number;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
}

export interface StockNotificationListDto {
  items: StockNotificationDto[];
  totalCount: number;
  unreadCount: number;
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
