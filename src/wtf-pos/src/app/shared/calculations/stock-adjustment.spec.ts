import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { adjustmentDelta, salesCovered } from './stock-adjustment';

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
