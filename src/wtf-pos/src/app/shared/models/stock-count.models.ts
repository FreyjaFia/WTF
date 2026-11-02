export enum StockCountStatus {
  Open = 1,
  Posted = 2,
  Cancelled = 3,
}

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  [StockCountStatus.Open]: 'Counting',
  [StockCountStatus.Posted]: 'Posted',
  [StockCountStatus.Cancelled]: 'Cancelled',
};

export interface StockCountSummaryDto {
  id: string;
  name: string;
  status: StockCountStatus;
  isBlind: boolean;
  note: string | null;
  createdAt: string;
  createdByName: string;
  postedAt: string | null;
  lineCount: number;
  countedCount: number;
}

export interface StockCountLineDto {
  itemId: string;
  itemName: string;
  unitName: string;
  countedQuantity: number | null;
  expectedQuantity: number | null;
  difference: number | null;
  adjustmentPosted: boolean;
}

export interface StockCountDto {
  summary: StockCountSummaryDto;
  lines: StockCountLineDto[];
}

export interface StartStockCountDto {
  name: string;
  isBlind: boolean;
  note: string | null;
  itemIds: string[] | null;
}

export interface StockCountEntryDto {
  itemId: string;
  countedQuantity: number | null;
}
