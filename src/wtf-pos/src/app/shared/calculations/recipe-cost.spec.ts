import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { margin, marginPercent, recipeCost, RecipeCostLine } from './recipe-cost';

interface RecipeCostCase {
  name: string;
  price: number;
  suppliesCost: number;
  lines: RecipeCostLine[];
  totalCost: number;
  unknownCostCount: number;
  margin: number;
  marginPercent: number | null;
}

describe('recipe cost: the cases shared with the API', () => {
  it.each((cases.recipeCost as RecipeCostCase[]).map((c) => [c.name, c] as const))(
    '%s',
    (_name, c) => {
      const summary = recipeCost(c.lines, c.suppliesCost);
      expect(summary.totalCost).toBeCloseTo(c.totalCost, 6);
      expect(summary.unknownCostCount).toBe(c.unknownCostCount);
      expect(margin(c.price, summary.totalCost)).toBeCloseTo(c.margin, 6);
      expect(marginPercent(c.price, summary.totalCost)).toBe(c.marginPercent);
    },
  );
});
