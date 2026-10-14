import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { average, percentChange, percentOfTotal } from './sales-stats';

interface AverageCase {
  name: string;
  amount: number;
  count: number;
  expected: number;
}

interface PercentCase {
  name: string;
  part: number;
  total: number;
  expected: number;
}

describe('sales stats: the cases shared with the API', () => {
  it.each((cases.average as AverageCase[]).map((c) => [c.name, c] as const))(
    'average: %s',
    (_name, c) => {
      expect(average(c.amount, c.count)).toBeCloseTo(c.expected, 4);
    },
  );

  it.each((cases.percentOfTotal as PercentCase[]).map((c) => [c.name, c] as const))(
    'percent of total: %s',
    (_name, c) => {
      expect(percentOfTotal(c.part, c.total)).toBeCloseTo(c.expected, 4);
    },
  );
});

describe('sales stats: percent change', () => {
  it('is the whole-number move against the previous figure', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(998.98, 120)).toBe(732);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('treats a previous figure of 0 as +100% when there is something now, else 0%', () => {
    expect(percentChange(5, 0)).toBe(100);
    expect(percentChange(0, 0)).toBe(0);
  });

  it('shows -100% when everything is gone', () => {
    expect(percentChange(0, 249.75)).toBe(-100);
  });
});
