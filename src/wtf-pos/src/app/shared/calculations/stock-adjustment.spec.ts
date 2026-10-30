import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { adjustmentDelta, effectiveQuantity, salesCovered } from './stock-adjustment';

interface SalesCoveredCase {
  name: string;
  balance: number;
  perSale: number;
  expected: number;
}

interface AdjustmentCase {
  name: string;
  shown: number;
  counted: number;
  expected: number;
}

describe('stock adjustment: the cases shared with the API', () => {
  it.each((cases.stockAdjustment as AdjustmentCase[]).map((c) => [c.name, c] as const))(
    'adjustment delta: %s',
    (_name, c) => {
      expect(adjustmentDelta(c.shown, c.counted)).toBeCloseTo(c.expected, 3);
    },
  );

  it.each((cases.salesCovered as SalesCoveredCase[]).map((c) => [c.name, c] as const))(
    'sales covered: %s',
    (_name, c) => {
      expect(salesCovered(c.balance, c.perSale)).toBe(c.expected);
    },
  );
});

describe('effective quantity with an allowance', () => {
  it('adds the allowance percent to the standard amount', () => {
    expect(effectiveQuantity(200, 5)).toBe(210);
    expect(effectiveQuantity(18, 2.5)).toBe(18.45);
  });

  it('keeps the amount when there is no allowance', () => {
    expect(effectiveQuantity(200, 0)).toBe(200);
    expect(effectiveQuantity(200, Number.NaN)).toBe(200);
    expect(effectiveQuantity(200, -5)).toBe(200);
  });

  it('rounds to three decimals', () => {
    expect(effectiveQuantity(1, 33.3333)).toBe(1.333);
  });
});
