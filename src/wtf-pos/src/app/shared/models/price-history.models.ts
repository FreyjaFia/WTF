export interface PriceHistoryEntryDto {
  id: string;
  oldPrice?: number | null;
  newPrice: number;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string | null;
}
