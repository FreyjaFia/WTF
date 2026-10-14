import { describe, expect, it } from 'vitest';
import { addMoney, fromCents, roundMoney, subtractMoney, sumAmounts, toCents } from './money';

describe('money', () => {
  it('converts to cents and back without drifting', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
  });

  it('adds exactly', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(sumAmounts([33.33, 33.33, 33.34])).toBe(100);
    expect(sumAmounts([])).toBe(0);
  });

  it('subtracts exactly and can go negative', () => {
    expect(subtractMoney(1, 0.9)).toBe(0.1);
    expect(subtractMoney(500, 280)).toBe(220);
    expect(subtractMoney(100, 120.5)).toBe(-20.5);
  });

  it('rounds to the centavo', () => {
    expect(roundMoney(1.005 * 100)).toBe(100.5);
    expect(roundMoney(99.9999)).toBe(100);
    expect(roundMoney(12.344)).toBe(12.34);
  });
});
