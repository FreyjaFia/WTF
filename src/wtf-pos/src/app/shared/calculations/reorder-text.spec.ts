import { ReorderGroupDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { reorderMessage } from './reorder-text';

const line = (overrides: object) => ({
  itemId: 'i',
  itemName: 'Oat Milk',
  unitName: 'bottle',
  onHand: 10,
  parLevel: 48,
  onOrder: 0,
  daysOfCover: null,
  suggestedUnits: 48,
  suggestedPacks: 4,
  packName: 'carton',
  unitsPerPack: 12,
  packPrice: null,
  estimatedCost: null,
  ...overrides,
});

describe('reorderMessage', () => {
  it('asks for packs when the supplier pack is known and units otherwise', () => {
    const group = {
      supplierId: 's1',
      supplierName: 'Metro Dairy',
      leadTimeDays: 2,
      estimatedCost: null,
      lines: [line({}), line({ itemName: 'Cups', unitName: 'piece', suggestedUnits: 95, suggestedPacks: null, packName: null })],
    } as ReorderGroupDto;

    expect(reorderMessage(group)).toBe('Order for Metro Dairy\n- Oat Milk: 4 carton\n- Cups: 95 piece');
  });
});
