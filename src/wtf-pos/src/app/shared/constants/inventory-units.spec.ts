import { describe, expect, it } from 'vitest';
import { getInventoryUnitAbbreviation, INVENTORY_UNIT_OPTIONS } from './inventory-units';

describe('inventory units', () => {
  it('has unique values and non-empty labels/abbreviations', () => {
    const values = INVENTORY_UNIT_OPTIONS.map((u) => u.value);
    expect(new Set(values).size).toBe(values.length);
    for (const unit of INVENTORY_UNIT_OPTIONS) {
      expect(unit.label.length).toBeGreaterThan(0);
      expect(unit.abbreviation.length).toBeGreaterThan(0);
    }
  });

  it('resolves known abbreviations', () => {
    expect(getInventoryUnitAbbreviation('piece')).toBe('pc');
    expect(getInventoryUnitAbbreviation('liter')).toBe('L');
    expect(getInventoryUnitAbbreviation('milliliter')).toBe('ml');
  });

  it('falls back to the raw name for unknown units', () => {
    expect(getInventoryUnitAbbreviation('barrel')).toBe('barrel');
  });

  it('returns an empty string for null or undefined', () => {
    expect(getInventoryUnitAbbreviation(null)).toBe('');
    expect(getInventoryUnitAbbreviation(undefined)).toBe('');
  });
});
