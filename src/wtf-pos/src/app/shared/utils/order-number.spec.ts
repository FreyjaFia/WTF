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
