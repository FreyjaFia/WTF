export interface InventoryItemDto {
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
  createdAt: string;
  createdBy: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  productLinks: ProductInventoryLinkDto[];
  recentMovements: StockMovementDto[];
}

export interface ProductInventoryLinkDto {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  inventoryItemId: string;
  quantityPerSale: number;
  isActive: boolean;
}

export interface StockMovementDto {
  id: string;
  inventoryItemId: string;
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
}

export interface CreateInventoryItemDto {
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
  isActive: boolean;
}

export interface UpdateInventoryItemDto {
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
  isActive: boolean;
}

export interface AddInventoryStockDto {
  inventoryItemId: string;
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
}
