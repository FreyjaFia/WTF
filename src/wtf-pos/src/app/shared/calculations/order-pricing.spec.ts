import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  PricedLine,
  addOnsTotal,
  cartTotal,
  discountedLineTotal,
  extendedPrice,
  isBundleLine,
  lineTotal,
  lineUnitSubtotal,
  promoDiscount,
  savedLineTotal,
  priceWithAddOns,
} from './order-pricing';

interface OrderCase {
  name: string;
  lines: { quantity: number; price: number; addOns: { price: number; quantity: number }[] }[];
  bundles: { unitPrice: number; quantity: number; items: unknown[] }[];
  expectedTotal: number;
  expectedLineTotals?: number[];
}

const orderCases = cases.orderTotals as OrderCase[];

function toCartLines(orderCase: OrderCase): PricedLine[] {
  return [
    ...orderCase.lines.map((line) => ({
      qty: line.quantity,
      price: line.price,
      addOns: line.addOns,
    })),
    ...orderCase.bundles.map((bundle) => ({
      qty: bundle.quantity,
      price: bundle.unitPrice,
      bundleItems: bundle.items,
    })),
  ];
}

describe('order pricing: the cases shared with the API', () => {
  it.each(orderCases.map((c) => [c.name, c] as const))('total: %s', (_name, orderCase) => {
    expect(cartTotal(toCartLines(orderCase))).toBe(orderCase.expectedTotal);
  });

  it.each(orderCases.filter((c) => c.expectedLineTotals).map((c) => [c.name, c] as const))(
    'line totals: %s',
    (_name, orderCase) => {
      const totals = orderCase.lines.map((line) =>
        lineTotal({ qty: line.quantity, price: line.price, addOns: line.addOns }),
      );
      expect(totals).toEqual(orderCase.expectedLineTotals);
    },
  );

  it.each(orderCases.filter((c) => c.expectedLineTotals).map((c) => [c.name, c] as const))(
    'a saved order line totals the same as a cart line: %s',
    (_name, orderCase) => {
      const totals = orderCase.lines.map((line) => savedLineTotal(line));
      expect(totals).toEqual(orderCase.expectedLineTotals);
    },
  );
});

describe('order pricing: pieces', () => {
  it('adds add-ons per item, each times its quantity (default 1)', () => {
    expect(addOnsTotal([{ price: 10 }, { price: 5, quantity: 2 }])).toBe(20);
    expect(addOnsTotal(undefined)).toBe(0);
    expect(addOnsTotal([])).toBe(0);
  });

  it('prices one item with its add-ons and extends it by a quantity', () => {
    expect(priceWithAddOns(100, [{ price: 10 }])).toBe(110);
    expect(extendedPrice(110, 3)).toBe(330);
    expect(extendedPrice(0.1, 3)).toBe(0.3);
  });

  it('a discounted base price replaces the line price but keeps the add-ons', () => {
    const line: PricedLine = { qty: 2, price: 100, addOns: [{ price: 10 }] };
    expect(lineUnitSubtotal(line)).toBe(110);
    expect(lineUnitSubtotal(line, 90)).toBe(100);
    expect(lineTotal(line, 90)).toBe(200);
  });

  it('a bundle line is sold at its own price and ignores add-ons and discounts', () => {
    const bundle: PricedLine = { qty: 2, price: 150, addOns: [{ price: 10 }], bundleItems: [{}] };
    expect(isBundleLine(bundle)).toBe(true);
    expect(lineUnitSubtotal(bundle, 10)).toBe(150);
    expect(lineTotal(bundle)).toBe(300);
    expect(isBundleLine({ bundleItems: [] })).toBe(false);
  });

  it('prices the cart with a per-line discounted base when one is given', () => {
    const lines: PricedLine[] = [
      { qty: 1, price: 100 },
      { qty: 2, price: 50 },
    ];
    expect(cartTotal(lines, (line) => (line.price === 100 ? { price: 80, quantity: 1 } : null))).toBe(180);
  });

  it('a discount that covers only part of a line charges the rest at the list price', () => {
    const line: PricedLine = { qty: 5, price: 100, addOns: [{ price: 10 }] };
    // 2 items at 50 + 10 add-on, 3 items at 100 + 10 add-on
    expect(discountedLineTotal(line, { price: 50, quantity: 2 })).toBe(2 * 60 + 3 * 110);
    expect(discountedLineTotal(line, { price: 50, quantity: 9 })).toBe(5 * 60);
    expect(discountedLineTotal(line, { price: 50, quantity: 0 })).toBe(5 * 110);
    expect(discountedLineTotal(line, null)).toBe(5 * 110);
    expect(discountedLineTotal({ qty: 2, price: 150, bundleItems: [{}] }, { price: 1, quantity: 2 })).toBe(300);
  });

  it('an unpriced saved line counts as 0', () => {
    expect(
      savedLineTotal({ price: null, quantity: 2, addOns: [{ price: null, quantity: 1 }] }),
    ).toBe(0);
    expect(savedLineTotal({ quantity: 1, addOns: [{ price: 5, quantity: 2 }] })).toBe(10);
  });

  it('a promotion discount is the list price minus the charge, per item, never negative', () => {
    expect(promoDiscount(100, 90, 3)).toBe(30);
    expect(promoDiscount(100, 100, 3)).toBe(0);
    expect(promoDiscount(90, 100, 3)).toBe(0);
    expect(promoDiscount(0.3, 0.1, 3)).toBe(0.6);
  });
});
