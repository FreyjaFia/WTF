import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { wasteBalanceAfter, wasteNeedsReview, wasteShortfall } from './waste';

interface NeedsReviewCase {
  name: string;
  quantity: number;
  limit: number | null;
  expected: boolean;
}

interface BalanceAfterCase {
  name: string;
  balance: number;
  quantity: number;
  expected: number;
}

describe('wasteNeedsReview: the cases shared with the API', () => {
  it.each((cases.wasteNeedsReview as NeedsReviewCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(wasteNeedsReview(c.quantity, c.limit)).toBe(c.expected);
  });
});

describe('wasteBalanceAfter: the cases shared with the API', () => {
  it.each((cases.wasteBalanceAfter as BalanceAfterCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(wasteBalanceAfter(c.balance, c.quantity)).toBe(c.expected);
  });
});

describe('wasteNeedsReview', () => {
  it('treats an undefined limit as no limit', () => {
    expect(wasteNeedsReview(99999, undefined)).toBe(false);
  });

  it('ignores differences below a thousandth', () => {
    expect(wasteNeedsReview(500.0004, 500)).toBe(false);
  });
});

describe('wasteShortfall', () => {
  it('is zero when the balance covers the waste', () => {
    expect(wasteShortfall(10, 10)).toBe(0);
    expect(wasteShortfall(10, 3)).toBe(0);
  });

  it('is what the balance is short of', () => {
    expect(wasteShortfall(2, 3)).toBe(1);
    expect(wasteShortfall(2.5, 2.75)).toBe(0.25);
  });

  it('never exceeds the waste itself when the balance is already negative', () => {
    expect(wasteShortfall(-4, 0.5)).toBe(0.5);
  });
});
