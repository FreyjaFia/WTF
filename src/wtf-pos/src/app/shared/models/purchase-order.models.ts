export const PurchaseOrderStatus = {
  Draft: 1,
  Sent: 2,
  PartlyReceived: 3,
  Received: 4,
  Cancelled: 5,
} as const;

export interface PurchaseOrderSummaryDto {
  id: string;
  poNumber: number;
  supplierId: string;
  supplierName: string;
  status: number;
  expectedOn: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string;
  sentAt: string | null;
  lineCount: number;
  total: number | null;
}

export interface PurchaseOrderLineDto {
  itemId: string;
  itemName: string;
  unitName: string;
  packName: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  packsOrdered: number;
  packsReceived: number;
  lineTotal: number | null;
}

export interface PurchaseOrderDto {
  summary: PurchaseOrderSummaryDto;
  lines: PurchaseOrderLineDto[];
  receiptIds: string[];
}

export interface PurchaseOrderLineRequestDto {
  itemId: string;
  packs: number;
  unitsPerPack: number;
  packPrice: number | null;
  packName: string | null;
}

export interface PurchaseOrderFieldsDto {
  supplierId: string;
  expectedOn: string | null;
  note: string | null;
  lines: PurchaseOrderLineRequestDto[];
}
