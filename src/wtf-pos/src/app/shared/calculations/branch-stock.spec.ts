import { describe, expect, it } from 'vitest';
import { branchItemCost, branchLevel } from './branch-stock';
import cases from './calculation-cases.json';

interface BranchItemCostCase {
  name: string;
  branchCost: number | null;
  averageCost: number | null;
  costPrice: number | null;
  expected: number | null;
}

interface BranchLevelCase {
  name: string;
  branchLevel: number | null;
  shopLevel: number | null;
  expected: number | null;
}

describe('branch cost: the cases shared with the API', () => {
  it.each((cases.branchItemCost as BranchItemCostCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(branchItemCost(c.branchCost, c.averageCost, c.costPrice)).toBe(c.expected);
  });
});

describe('branch stock levels: the cases shared with the API', () => {
  it.each((cases.branchLevel as BranchLevelCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(branchLevel(c.branchLevel, c.shopLevel)).toBe(c.expected);
  });
});
