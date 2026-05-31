export const INVENTORY_UNIT_OPTIONS = [
  { value: 'piece', label: 'Piece', abbreviation: 'pc' },
  { value: 'box', label: 'Box', abbreviation: 'box' },
  { value: 'pack', label: 'Pack', abbreviation: 'pack' },
  { value: 'case', label: 'Case', abbreviation: 'case' },
  { value: 'bottle', label: 'Bottle', abbreviation: 'btl' },
  { value: 'carton', label: 'Carton', abbreviation: 'ctn' },
  { value: 'cup', label: 'Cup', abbreviation: 'cup' },
  { value: 'lid', label: 'Lid', abbreviation: 'lid' },
  { value: 'sleeve', label: 'Sleeve', abbreviation: 'slv' },
  { value: 'liter', label: 'Liter', abbreviation: 'L' },
  { value: 'milliliter', label: 'Milliliter', abbreviation: 'ml' },
  { value: 'kilogram', label: 'Kilogram', abbreviation: 'kg' },
  { value: 'gram', label: 'Gram', abbreviation: 'g' },
] as const;

export type InventoryUnitValue = (typeof INVENTORY_UNIT_OPTIONS)[number]['value'];

export function getInventoryUnitAbbreviation(unitName: string | null | undefined): string {
  return (
    INVENTORY_UNIT_OPTIONS.find((unit) => unit.value === unitName)?.abbreviation ??
    unitName ??
    ''
  );
}
