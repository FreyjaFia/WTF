import { describe, expect, it } from 'vitest';
import { AddOnTypeEnum } from '../models/product.models';
import {
  BreakdownAddOn,
  breakdownOfCartItem,
  buildLineBreakdown,
  countedName,
  addOnDetail,
  formatPeso,
  groupAddOns,
  listUnitPriceOf,
  normalizeSortLabel,
} from './line-breakdown';

const addOn = (
  id: string,
  name: string,
  price: number,
  addOnType?: AddOnTypeEnum,
  quantity?: number,
): BreakdownAddOn => ({ addOnId: id, name, price, addOnType, quantity });

describe('line breakdown', () => {
  describe('formatPeso', () => {
    it('shows two decimals with thousands separators and never a sign', () => {
      expect(formatPeso(1234.5)).toBe('₱1,234.50');
      expect(formatPeso(-5)).toBe('₱5.00');
      expect(formatPeso(0)).toBe('₱0.00');
    });
  });

  describe('normalizeSortLabel and countedName', () => {
    it('drops an "N x" prefix and case', () => {
      expect(normalizeSortLabel(' 2x Zebra')).toBe('zebra');
      expect(normalizeSortLabel('Latte')).toBe('latte');
    });

    it('writes the count only above one', () => {
      expect(countedName('Oat Milk', 1)).toBe('Oat Milk');
      expect(countedName('Oat Milk', 2)).toBe('2x Oat Milk');
    });
  });

  describe('groupAddOns', () => {
    it('is empty without add-ons', () => {
      expect(groupAddOns(null)).toEqual([]);
      expect(groupAddOns(undefined)).toEqual([]);
      expect(groupAddOns([])).toEqual([]);
    });

    it('merges repeats of the same add-on at the same price and keeps different prices apart', () => {
      const groups = groupAddOns([
        addOn('s', 'Sugar', 5),
        addOn('s', 'Sugar', 5),
        addOn('s', 'Sugar', 8),
      ]);
      expect(groups.map((g) => [g.price, g.countPerItem])).toEqual([
        [5, 2],
        [8, 1],
      ]);
    });

    it('counts a customer-cart add-on by its quantity, at least one', () => {
      const groups = groupAddOns([
        addOn('e', 'Extra shot', 40, undefined, 3),
        addOn('r', 'Regular', 0, undefined, 0),
      ]);
      expect(groups.map((g) => [g.name, g.countPerItem])).toEqual([
        ['Extra shot', 3],
        ['Regular', 1],
      ]);
    });

    it('orders Size, Flavor, Sauce, Topping, Extra, then unknown types, then by name', () => {
      const groups = groupAddOns([
        addOn('x', 'Zed', 1),
        addOn('a', 'Alpha', 1),
        addOn('e', 'E', 1, AddOnTypeEnum.Extra),
        addOn('t', 'T', 1, AddOnTypeEnum.Topping),
        addOn('s', 'S', 1, AddOnTypeEnum.Sauce),
        addOn('f', 'F', 1, AddOnTypeEnum.Flavor),
        addOn('z', 'Z', 1, AddOnTypeEnum.Size),
      ]);
      expect(groups.map((g) => g.name)).toEqual(['Z', 'F', 'S', 'T', 'E', 'Alpha', 'Zed']);
    });

    it('sorts by name ignoring an "N x" prefix', () => {
      const groups = groupAddOns([addOn('b', '2x Banana', 1), addOn('a', 'Apple', 1)]);
      expect(groups.map((g) => g.addOnId)).toEqual(['a', 'b']);
    });
  });

  describe('addOnDetail', () => {
    it.each([
      [30, 1, 1, null],
      [0, 1, 2, null],
      [40, 2, 1, '₱40.00 × 2'],
      [30, 1, 2, '₱30.00 each'],
      [40, 2, 2, '₱40.00 × 4 (2 per item)'],
    ])('price %d, %d per item, %d items', (price, perItem, qty, expected) => {
      expect(addOnDetail(price, perItem, qty)).toBe(expected);
    });

    it('keeps the count wording for toppings and extras', () => {
      expect(addOnDetail(40, 2, 2)).toBe('₱40.00 × 4 (2 per item)');
    });
  });

  describe('listUnitPriceOf', () => {
    it('is the charged price when nothing was taken off', () => {
      expect(listUnitPriceOf(120, null, 2)).toBe(120);
      expect(listUnitPriceOf(120, 0, 2)).toBe(120);
      expect(listUnitPriceOf(120, 60, 0)).toBe(120);
    });

    it('adds the discount per item back to the charged price', () => {
      expect(listUnitPriceOf(120, 60, 2)).toBe(150);
      expect(listUnitPriceOf(0, 150, 1)).toBe(150);
    });

    it('stays exact in cents', () => {
      expect(listUnitPriceOf(0.1, 0.2, 1)).toBe(0.3);
    });
  });

  describe('buildLineBreakdown', () => {
    it('has no rows for a plain line, only the total', () => {
      const result = buildLineBreakdown({ qty: 3, listUnitPrice: 100 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(300);
    });

    it('lists the base then each add-on with per-line counts', () => {
      const result = buildLineBreakdown({
        qty: 2,
        listUnitPrice: 150,
        addOns: [
          addOn('l', 'Large', 30, AddOnTypeEnum.Size),
          addOn('e', 'Extra shot', 40, AddOnTypeEnum.Extra),
          addOn('e', 'Extra shot', 40, AddOnTypeEnum.Extra),
        ],
      });
      expect(result.rows).toEqual([
        { kind: 'base', label: 'Price', detail: '₱150.00 each', amount: 300 },
        { kind: 'addOn', label: 'Large', detail: '₱30.00 each', amount: 60 },
        { kind: 'addOn', label: 'Extra shot', detail: '₱40.00 × 4 (2 per item)', amount: 160 },
      ]);
      expect(result.total).toBe(520);
    });

    it('leaves the detail out when there is one of something', () => {
      const result = buildLineBreakdown({
        qty: 1,
        listUnitPrice: 100,
        addOns: [addOn('l', 'Large', 30)],
      });
      expect(result.rows[0].detail).toBeNull();
      expect(result.rows[1].detail).toBeNull();
    });

    it('subtracts a promotion and describes it', () => {
      const result = buildLineBreakdown({
        qty: 2,
        listUnitPrice: 150,
        addOns: [addOn('l', 'Large', 30)],
        discount: { amount: 60, label: 'Promo -₱30.00' },
      });
      expect(result.rows[2]).toEqual({
        kind: 'discount',
        label: 'Discount',
        detail: null,
        amount: -60,
      });
      expect(result.total).toBe(300);
    });

    it('shows a promotion that covers only part of the line', () => {
      const result = buildLineBreakdown({
        qty: 5,
        listUnitPrice: 150,
        discount: { amount: 60, label: 'Promo -₱30.00' },
      });
      expect(result.rows.map((r) => [r.kind, r.amount])).toEqual([
        ['base', 750],
        ['discount', -60],
      ]);
      expect(result.total).toBe(690);
    });

    it('keeps a negative add-on price as a minus row', () => {
      const result = buildLineBreakdown({
        qty: 2,
        listUnitPrice: 100,
        addOns: [addOn('n', 'No sugar', -5)],
      });
      expect(result.rows[1]).toMatchObject({ kind: 'addOn', amount: -10, detail: '₱5.00 each' });
      expect(result.total).toBe(190);
    });

    it('ignores a zero or missing discount', () => {
      expect(
        buildLineBreakdown({ qty: 1, listUnitPrice: 50, discount: { amount: 0 } }).rows,
      ).toEqual([]);
      expect(buildLineBreakdown({ qty: 1, listUnitPrice: 50, discount: null }).rows).toEqual([]);
    });

    it('treats a quantity below one as one', () => {
      const result = buildLineBreakdown({
        qty: 0,
        listUnitPrice: 50,
        addOns: [addOn('a', 'A', 5)],
      });
      expect(result.total).toBe(55);
    });

    it('is exact in cents', () => {
      const result = buildLineBreakdown({
        qty: 3,
        listUnitPrice: 0.1,
        addOns: [addOn('a', 'A', 0.2)],
      });
      expect(result.total).toBe(0.9);
    });

    it.each([
      { qty: 1, price: 100, addOns: [addOn('a', 'A', 10)], discount: 0 },
      {
        qty: 3,
        price: 99.99,
        addOns: [addOn('a', 'A', 12.5), addOn('a', 'A', 12.5), addOn('b', 'B', -3.25)],
        discount: 20.01,
      },
      { qty: 4, price: 80, addOns: [addOn('c', 'C', 0)], discount: 80 },
    ])('the rows add up to the total ($qty x $price)', ({ qty, price, addOns, discount }) => {
      const result = buildLineBreakdown({
        qty,
        listUnitPrice: price,
        addOns,
        discount: discount ? { amount: discount, label: 'Free' } : null,
      });
      const cents = result.rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
      expect(cents).toBe(Math.round(result.total * 100));
    });
  });

  describe('breakdownOfCartItem', () => {
    it('uses the list price when a promotion changed the charged price', () => {
      const result = breakdownOfCartItem({
        qty: 2,
        price: 120,
        originalPrice: 150,
        addOns: [],
        promoDiscount: 60,
        promoLabel: 'Promo -₱30.00',
      });
      expect(result.rows.map((r) => [r.kind, r.amount])).toEqual([
        ['base', 300],
        ['discount', -60],
      ]);
      expect(result.total).toBe(240);
    });

    it('gives a plain line of several items one price row, and a single item none', () => {
      const plain = { price: 120, addOns: [] as never[] };
      expect(breakdownOfCartItem({ ...plain, qty: 2 })).toEqual({
        rows: [{ kind: 'base', label: 'Price', detail: '₱120.00 each', amount: 240 }],
        total: 240,
      });
      expect(breakdownOfCartItem({ ...plain, qty: 1 })).toEqual({ rows: [], total: 120 });
    });

    it('uses the price when there is no list price or discount', () => {
      const result = breakdownOfCartItem({
        qty: 1,
        price: 100,
        addOns: [{ addOnId: 'a', name: 'A', price: 10 }],
      });
      expect(result.rows.map((r) => r.amount)).toEqual([100, 10]);
      expect(result.total).toBe(110);
    });
  });
});
