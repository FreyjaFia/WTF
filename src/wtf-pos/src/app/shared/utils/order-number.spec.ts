import { describe, expect, it } from 'vitest';
import cases from '../calculations/calculation-cases.json';
import { orderNumberLabel } from './order-number';

describe('orderNumberLabel', () => {
  it('adds the branch code and pads the number when the shop has several branches', () => {
    expect(orderNumberLabel(42, 'MKT', true)).toBe('MKT-0042');
    expect(orderNumberLabel(12345, 'QC', true)).toBe('QC-12345');
  });

  it('keeps the plain number for a one-branch shop', () => {
    expect(orderNumberLabel(42, 'MKT', false)).toBe('#42');
  });

  it('keeps the plain number when the order has no branch code', () => {
    expect(orderNumberLabel(42, null, true)).toBe('#42');
  });
});

describe('orderNumberLabel: the cases shared with the API', () => {
  interface OrderLabelCase {
    name: string;
    orderNumber: number;
    branchCode: string | null;
    showBranch: boolean;
    expected: string;
  }

  it.each((cases.orderLabels as OrderLabelCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(orderNumberLabel(c.orderNumber, c.branchCode, c.showBranch)).toBe(c.expected);
  });
});
