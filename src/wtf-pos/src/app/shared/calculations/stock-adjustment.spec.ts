import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { adjustmentDelta } from './stock-adjustment';

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
});
