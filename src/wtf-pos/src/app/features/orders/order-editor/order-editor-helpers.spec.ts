import type { CartAddOnDto, CustomerDto } from '@shared/models';
import { PaymentMethodEnum } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  customerDisplayName,
  groupAddOns,
  isPromotionActiveInUserTimezone,
  nameParts,
  normalizeSortLabel,
  paymentMethodLabel,
} from './order-editor-helpers';

describe('nameParts', () => {
  it('returns the whole name when there is no search term', () => {
    expect(nameParts('Iced Latte', '')).toEqual([{ text: 'Iced Latte', isMatch: false }]);
    expect(nameParts('Iced Latte', '  ')).toEqual([{ text: 'Iced Latte', isMatch: false }]);
    expect(nameParts('Iced Latte', null)).toEqual([{ text: 'Iced Latte', isMatch: false }]);
  });

  it('splits matches case-insensitively and keeps the original casing', () => {
    expect(nameParts('Iced Latte', 'LATTE')).toEqual([
      { text: 'Iced ', isMatch: false },
      { text: 'Latte', isMatch: true },
    ]);
  });

  it('marks every occurrence and trims the term', () => {
    expect(nameParts('banana', ' an ')).toEqual([
      { text: 'b', isMatch: false },
      { text: 'an', isMatch: true },
      { text: 'an', isMatch: true },
      { text: 'a', isMatch: false },
    ]);
  });

  it('returns the whole name when nothing matches', () => {
    expect(nameParts('Latte', 'xyz')).toEqual([{ text: 'Latte', isMatch: false }]);
  });
});

describe('normalizeSortLabel', () => {
  it('drops a leading quantity and lowercases', () => {
    expect(normalizeSortLabel('2x Latte')).toBe('latte');
    expect(normalizeSortLabel('  12 X Mocha ')).toBe('mocha');
    expect(normalizeSortLabel('Latte')).toBe('latte');
  });
});

describe('customerDisplayName and paymentMethodLabel', () => {
  it('joins and trims the customer name', () => {
    expect(customerDisplayName({ firstName: 'Ana', lastName: '' } as CustomerDto)).toBe('Ana');
    expect(customerDisplayName({ firstName: 'Ana', lastName: 'Cruz' } as CustomerDto)).toBe(
      'Ana Cruz',
    );
  });

  it('labels payment methods', () => {
    expect(paymentMethodLabel(PaymentMethodEnum.Cash)).toBe('Cash');
    expect(paymentMethodLabel(PaymentMethodEnum.GCash)).toBe('GCash');
    expect(paymentMethodLabel(null)).toBe('N/A');
    expect(paymentMethodLabel(undefined)).toBe('N/A');
  });
});

describe('groupAddOns', () => {
  const addOns = [
    { addOnId: 'a', price: 10 },
    { addOnId: 'b', price: 5 },
    { addOnId: 'a', price: 10 },
  ] as CartAddOnDto[];

  it('returns nothing without add-ons', () => {
    expect(groupAddOns(undefined)).toEqual([]);
    expect(groupAddOns([])).toEqual([]);
  });

  it('counts repeats and leaves quotes out by default', () => {
    expect(groupAddOns(addOns)).toEqual([
      { productId: 'a', quantity: 2, addOns: [], bundlePromotionId: null },
      { productId: 'b', quantity: 1, addOns: [], bundlePromotionId: null },
    ]);
  });

  it('adds the quoted price when asked', () => {
    expect(groupAddOns(addOns, true)).toEqual([
      { productId: 'a', quantity: 2, addOns: [], bundlePromotionId: null, quotedPrice: 10 },
      { productId: 'b', quantity: 1, addOns: [], bundlePromotionId: null, quotedPrice: 5 },
    ]);
  });
});

describe('isPromotionActiveInUserTimezone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const promo = (over: Record<string, unknown>) =>
    ({ isActive: true, startDate: null, endDate: null, schedule: null, ...over }) as never;

  it('is false when the promotion is off', () => {
    expect(isPromotionActiveInUserTimezone(promo({ isActive: false }))).toBe(false);
  });

  it('is true with no dates', () => {
    expect(isPromotionActiveInUserTimezone(promo({}))).toBe(true);
  });

  it('respects the start and end dates by local day', () => {
    expect(
      isPromotionActiveInUserTimezone(promo({ startDate: new Date(2026, 10, 8).toISOString() })),
    ).toBe(false);
    expect(
      isPromotionActiveInUserTimezone(promo({ startDate: new Date(2026, 10, 7).toISOString() })),
    ).toBe(true);
    expect(
      isPromotionActiveInUserTimezone(promo({ endDate: new Date(2026, 10, 6).toISOString() })),
    ).toBe(false);
    expect(
      isPromotionActiveInUserTimezone(promo({ endDate: new Date(2026, 10, 7).toISOString() })),
    ).toBe(true);
  });

  it('is false for an invalid date', () => {
    expect(isPromotionActiveInUserTimezone(promo({ startDate: 'nope' }))).toBe(false);
    expect(isPromotionActiveInUserTimezone(promo({ endDate: 'nope' }))).toBe(false);
  });
});
