import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { amountDue, cashChange } from './cash-payment';

interface CashCase {
  name: string;
  total: number;
  tips: number | null;
  received: number;
  expectedDue: number;
  expectedChange: number;
}

describe('cash payment: the cases shared with the API', () => {
  it.each((cases.cashPayment as CashCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(amountDue(c.total, c.tips)).toBe(c.expectedDue);
    expect(cashChange(c.received, c.total, c.tips)).toBe(c.expectedChange);
  });
});

describe('cash payment: pieces', () => {
  it('a missing tip counts as none', () => {
    expect(amountDue(629)).toBe(629);
    expect(amountDue(629, undefined)).toBe(629);
  });
});
