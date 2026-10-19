import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  DiscountRule,
  DiscountAllowance,
  allocateDiscounts,
  calculateDiscountedUnitPrice,
  countAddOns,
  findBestDiscount,
  formatPromoLabel,
  satisfiesExactAddOns,
} from './promotion-pricing';

interface DiscountCase {
  name: string;
  basePrice: number;
  fixedPrice: number | null;
  percentOff: number | null;
  expected: number | null;
}

interface LabelCase {
  name: string;
  fixedPrice: number | null;
  percentOff: number | null;
  basePrice?: number | null;
  addOnsPerUnit?: number;
  expected: string | null;
}

interface BestDiscountCase {
  name: string;
  basePrice: number;
  cartAddOns: { id: string; quantity: number }[];
  rules: {
    fixedPrice: number | null;
    percentOff: number | null;
    requiredAddOns: { id: string; quantity: number }[];
    remaining?: number | null;
    maxPerOrder?: number | null;
  }[];
  quantity?: number;
  expected: { price: number; label: string; discountedQuantity?: number } | null;
}

describe('promotion pricing: the cases shared with the API', () => {
  it.each((cases.discountedUnitPrice as DiscountCase[]).map((c) => [c.name, c] as const))(
    'discounted price: %s',
    (_name, c) => {
      expect(calculateDiscountedUnitPrice(c.basePrice, c.fixedPrice, c.percentOff)).toBe(
        c.expected,
      );
    },
  );

  it.each((cases.promoLabels as LabelCase[]).map((c) => [c.name, c] as const))(
    'promo label: %s',
    (_name, c) => {
      expect(formatPromoLabel({ fixedPrice: c.fixedPrice, percentOff: c.percentOff }, c.basePrice, c.addOnsPerUnit ?? 0)).toBe(
        c.expected,
      );
    },
  );

  it.each((cases.bestDiscount as BestDiscountCase[]).map((c) => [c.name, c] as const))(
    'best discount: %s',
    (_name, c) => {
      const rules: DiscountRule[] = c.rules.map((rule, index) => ({
        fixedPrice: rule.fixedPrice,
        percentOff: rule.percentOff,
        remaining: rule.remaining,
        maxPerOrder: rule.maxPerOrder,
        promotionKey: String(index),
        addOns: rule.requiredAddOns.map((a) => ({ addOnProductId: a.id, quantity: a.quantity })),
      }));
      // The cart lists one id per add-on, repeated for its quantity.
      const cartIds = c.cartAddOns.flatMap((a) => Array.from({ length: a.quantity }, () => a.id));

      const best = findBestDiscount(c.basePrice, cartIds, rules, c.quantity ?? 1);

      if (c.expected === null) {
        expect(best).toBeNull();
        return;
      }

      expect(best?.price).toBe(c.expected.price);
      expect(best?.quantity).toBe(c.expected.discountedQuantity ?? c.quantity ?? 1);
      expect(best ? formatPromoLabel(best.rule) : null).toBe(c.expected.label);
    },
  );
});

describe('promotion pricing: pieces', () => {
  it('counts repeated add-on ids', () => {
    expect(countAddOns(['a', 'b', 'a'])).toEqual(
      new Map([
        ['a', 2],
        ['b', 1],
      ]),
    );
  });

  it('matches the add-ons exactly; a rule with none is for the plain item only', () => {
    const counts = countAddOns(['a', 'a']);
    expect(satisfiesExactAddOns(counts, [{ addOnProductId: 'a', quantity: 2 }])).toBe(true);
    expect(satisfiesExactAddOns(counts, [{ addOnProductId: 'a', quantity: 1 }])).toBe(false);
    expect(satisfiesExactAddOns(counts, [])).toBe(false);
    expect(satisfiesExactAddOns(new Map(), [])).toBe(true);
  });

  it('an add-on with a zero count does not block a match', () => {
    expect(
      satisfiesExactAddOns(
        new Map([
          ['a', 1],
          ['b', 0],
        ]),
        [{ addOnProductId: 'a', quantity: 1 }],
      ),
    ).toBe(true);
  });
});

describe('promotion pricing: limits shared by the lines of one order', () => {
  const half: DiscountRule = { percentOff: 50, addOns: [], promotionKey: 'p', maxPerOrder: 3 };
  const line = (quantity: number, productId = 'latte') => ({
    productId,
    basePrice: 100,
    addOnIds: [],
    quantity,
    eligible: true,
  });

  it('covers only as many items as the limit per order allows', () => {
    const best = findBestDiscount(100, [], [half], 5);
    expect(best?.quantity).toBe(3);
    expect(best?.requested).toBe(5);
  });

  it('shares the limit between lines, in order', () => {
    const matches = allocateDiscounts([line(2), line(2), line(2)], () => [half]);
    expect(matches.map((m) => m?.quantity ?? 0)).toEqual([2, 1, 0]);
  });

  it('does not share anything between different promotions', () => {
    const other: DiscountRule = { percentOff: 10, addOns: [], promotionKey: 'q', maxPerOrder: 1 };
    const matches = allocateDiscounts([line(2, 'a'), line(2, 'b')], (productId) => (productId === 'a' ? [half] : [other]));
    expect(matches.map((m) => m?.quantity)).toEqual([2, 1]);
  });

  it('skips lines that are not eligible (a bundle line)', () => {
    const matches = allocateDiscounts([{ ...line(2), eligible: false }, line(2)], () => [half]);
    expect(matches[0]).toBeNull();
    expect(matches[1]?.quantity).toBe(2);
  });

  it('takes the smaller of the uses left and the limit per order', () => {
    const allowance = new DiscountAllowance();
    const rule: DiscountRule = { percentOff: 50, addOns: [], remaining: 2, maxPerOrder: 4 };
    expect(allowance.available(rule)).toBe(2);
    allowance.use(rule, 2);
    expect(allowance.available(rule)).toBe(0);
  });
});
