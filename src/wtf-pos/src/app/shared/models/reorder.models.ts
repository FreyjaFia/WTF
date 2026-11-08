export interface ReorderLineDto {
  itemId: string;
  itemName: string;
  unitName: string;
  onHand: number;
  parLevel: number;
  onOrder: number;
  daysOfCover: number | null;
  suggestedUnits: number;
  suggestedPacks: number | null;
  packName: string | null;
  unitsPerPack: number | null;
  packPrice: number | null;
  estimatedCost: number | null;
}

export interface ReorderGroupDto {
  supplierId: string | null;
  supplierName: string;
  leadTimeDays: number | null;
  estimatedCost: number | null;
  lines: ReorderLineDto[];
}

export interface ReorderListDto {
  groups: ReorderGroupDto[];
  belowParCount: number;
  itemsWithoutPar: number;
}

export interface ParLevelRowDto {
  itemId: string;
  itemName: string;
  unitName: string;
  onHand: number;
  parLevel: number | null;
}
