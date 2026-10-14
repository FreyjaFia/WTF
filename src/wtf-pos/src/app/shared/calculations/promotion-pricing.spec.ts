import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import {
  DiscountRule,
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
  }[];
  expected: { price: number; label: string } | null;
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
      expect(formatPromoLabel({ fixedPrice: c.fixedPrice, percentOff: c.percentOff })).toBe(
        c.expected,
      );
    },
  );

  it.each((cases.bestDiscount as BestDiscountCase[]).map((c) => [c.name, c] as const))(
    'best discount: %s',
    (_name, c) => {
      const rules: DiscountRule[] = c.rules.map((rule) => ({
        fixedPrice: rule.fixedPrice,
        percentOff: rule.percentOff,
        addOns: rule.requiredAddOns.map((a) => ({ addOnProductId: a.id, quantity: a.quantity })),
      }));
      // The cart lists one id per add-on, repeated for its quantity.
      const cartIds = c.cartAddOns.flatMap((a) => Array.from({ length: a.quantity }, () => a.id));

      const best = findBestDiscount(c.basePrice, cartIds, rules);

      if (c.expected === null) {
        expect(best).toBeNull();
        return;
      }

      expect(best?.price).toBe(c.expected.price);
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

  it('matches the add-ons exactly and never when none are required', () => {
    const counts = countAddOns(['a', 'a']);
    expect(satisfiesExactAddOns(counts, [{ addOnProductId: 'a', quantity: 2 }])).toBe(true);
    expect(satisfiesExactAddOns(counts, [{ addOnProductId: 'a', quantity: 1 }])).toBe(false);
    expect(satisfiesExactAddOns(counts, [])).toBe(false);
    expect(satisfiesExactAddOns(new Map(), [])).toBe(false);
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
