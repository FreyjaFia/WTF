export interface StockReceiptSummaryDto {
  id: string;
  supplierId: string;
  supplierName: string;
  receivedOn: string;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  linesTotal: number | null;
  difference: number | null;
  note: string | null;
  createdAt: string;
  createdByName: string;
  lineCount: number;
  purchaseOrderId: string | null;
  purchaseOrderNumber: number | null;
}

export interface StockReceiptLineDto {
  itemId: string;
  itemName: string;
  unitName: string;
  packName: string | null;
  packs: number;
  unitsPerPack: number;
  packPrice: number | null;
  quantity: number;
  unitCost: number | null;
  lineTotal: number | null;
}

export interface StockReceiptDto {
  summary: StockReceiptSummaryDto;
  lines: StockReceiptLineDto[];
}

export interface ReceiptLineRequestDto {
  itemId: string;
  packs: number;
  unitsPerPack: number;
  packPrice: number | null;
  packName: string | null;
}

export interface RecordStockReceiptDto {
  supplierId: string;
  receivedOn: string;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  note: string | null;
  clientRequestId: string;
  purchaseOrderId?: string | null;
  lines: ReceiptLineRequestDto[];
}
