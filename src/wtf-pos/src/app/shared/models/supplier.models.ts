export interface SupplierFieldsDto {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  notes: string | null;
}

export interface SupplierSummaryDto extends SupplierFieldsDto {
  id: string;
  isActive: boolean;
  itemCount: number;
}

export interface SupplierItemDto {
  linkId: string;
  itemId: string;
  itemName: string;
  unitName: string;
  supplierItemCode: string | null;
  packName: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitCost: number | null;
  isPreferred: boolean;
}

export interface SupplierDto {
  summary: SupplierSummaryDto;
  items: SupplierItemDto[];
}

export interface SupplierPriceChangeDto {
  oldPackPrice: number | null;
  newPackPrice: number;
  source: string;
  changedAt: string;
  changedByName: string;
}

export interface ItemSupplierDto {
  linkId: string;
  supplierId: string;
  supplierName: string;
  supplierIsActive: boolean;
  leadTimeDays: number | null;
  supplierItemCode: string | null;
  packName: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  unitCost: number | null;
  isPreferred: boolean;
  isCheapest: boolean;
  lastChangePercent: number | null;
  priceHistory: SupplierPriceChangeDto[];
}

export interface SaveItemSupplierDto {
  supplierItemCode: string | null;
  packName: string | null;
  unitsPerPack: number;
  packPrice: number | null;
  isPreferred: boolean;
}
