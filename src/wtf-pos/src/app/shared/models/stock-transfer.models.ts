export interface StockTransferSummaryDto {
  id: string;
  fromBranchId: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchCode: string;
  toBranchName: string;
  notes: string | null;
  createdAt: string;
  createdByName: string;
  lineCount: number;
  totalQuantity: number;
}

export interface StockTransferLineDto {
  itemId: string;
  itemName: string;
  unitName: string;
  quantity: number;
  unitCost: number | null;
}

export interface StockTransferDto {
  summary: StockTransferSummaryDto;
  lines: StockTransferLineDto[];
}

export interface CreateStockTransferDto {
  toBranchId: string;
  notes: string | null;
  lines: { itemId: string; quantity: number }[];
}
