export type StockWasteStatus = 'Recorded' | 'PendingReview' | 'Confirmed' | 'Disputed' | 'Reversed';

export const STOCK_WASTE_STATUSES: readonly StockWasteStatus[] = [
  'Recorded',
  'PendingReview',
  'Confirmed',
  'Disputed',
  'Reversed',
];

export const STOCK_WASTE_STATUS_LABELS: Record<StockWasteStatus, string> = {
  Recorded: 'Recorded',
  PendingReview: 'Needs review',
  Confirmed: 'Confirmed',
  Disputed: 'Disputed',
  Reversed: 'Reversed',
};

export enum StockWasteSource {
  ItemDetails = 1,
  Pos = 2,
}

export interface StockWasteDto {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  quantity: number;
  wasteReasonId: number;
  reasonName: string;
  notes?: string | null;
  status: StockWasteStatus;
  requiresReview: boolean;
  quantityBefore: number;
  quantityAfter: number;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
  reviewNote?: string | null;
  reversedAt?: string | null;
  reversedByName?: string | null;
  reversalReason?: string | null;
  source: StockWasteSource | number;
}

export interface RecordStockWasteDto {
  itemId: string;
  quantity: number;
  wasteReasonId: number;
  notes?: string | null;
  source?: StockWasteSource;
  clientRequestId?: string;
}

export interface PosWasteItemDto {
  id: string;
  name: string;
  baseUnit: string;
  stockUnitName?: string | null;
  unitsPerStockUnit?: number | null;
  currentQuantity: number;
  allowNegativeStock: boolean;
  wasteApprovalLimit?: number | null;
}

export interface StockWasteQuery {
  fromDate?: string | null;
  toDate?: string | null;
  itemId?: string | null;
  wasteReasonId?: number | null;
  status?: StockWasteStatus | null;
  createdBy?: string | null;
  page?: number;
  pageSize?: number;
}

export interface PagedStockWasteDto {
  items: StockWasteDto[];
  totalCount: number;
  pendingCount: number;
}

export interface StockWastePendingCountDto {
  count: number;
}

export interface WasteReasonDto {
  id: number;
  name: string;
  requiresNote: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export interface SaveWasteReasonDto {
  name: string;
  requiresNote: boolean;
  sortOrder: number;
}
