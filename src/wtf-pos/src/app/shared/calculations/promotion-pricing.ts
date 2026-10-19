import { fromCents, toCents } from './money';

/**
 * Discounted-product pricing. The TypeScript counterpart of `PromotionPricing` in the API's `WTF.Calculations` project;
 * both run the same cases from `calculation-cases.json`. The API prices the saved order; this shows the same price in
 * the cart before it is saved.
 */

export interface DiscountRuleAddOn {
  addOnProductId: string;
  quantity: number;
}

export interface DiscountRule {
  fixedPrice?: number | null;
  percentOff?: number | null;
  /** The add-ons the item must have, exactly (no more, no fewer). A rule with none is for the plain product. */
  addOns: readonly DiscountRuleAddOn[];
  /** How many more items the promotion can discount (its usage limit). Missing means no limit. */
  remaining?: number | null;
}

/** Counts how many of each add-on a cart item has. Pass one id per add-on, repeated for quantity. */
export function countAddOns(addOnIds: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of addOnIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return counts;
}

/** The item's add-ons must be exactly the rule's: every required one in the right amount, and nothing else. */
export function satisfiesExactAddOns(
  addOnCounts: ReadonlyMap<string, number>,
  requiredAddOns: readonly DiscountRuleAddOn[],
): boolean {
  const requiredIds = new Set(requiredAddOns.map((required) => required.addOnProductId));
  for (const required of requiredAddOns) {
    if ((addOnCounts.get(required.addOnProductId) ?? 0) !== required.quantity) {
      return false;
    }
  }

  for (const [id, quantity] of addOnCounts) {
    if (!requiredIds.has(id) && quantity > 0) {
      return false;
    }
  }

  return true;
}

/**
 * The discounted price of one item, or null when the rule gives none. A fixed amount wins over a percentage, a
 * discount never takes the price below zero, and a percentage is rounded to the centavo (half away from zero).
 */
export function calculateDiscountedUnitPrice(
  basePrice: number,
  fixedPrice?: number | null,
  percentOff?: number | null,
): number | null {
  if (fixedPrice != null && fixedPrice > 0) {
    return fromCents(Math.max(0, toCents(basePrice) - toCents(fixedPrice)));
  }

  if (percentOff != null && percentOff > 0) {
    // Whole-number arithmetic: cents times (100% - percent), both scaled, so a half centavo is detected exactly.
    const scaled = toCents(basePrice) * (10000 - Math.round(percentOff * 100));
    if (scaled <= 0) {
      return 0;
    }

    const whole = Math.floor(scaled / 10000);
    const remainder = scaled - whole * 10000;
    return fromCents(remainder >= 5000 ? whole + 1 : whole);
  }

  return null;
}

/** The label saved with a discounted line, for example "Promo -10%", "Promo -₱5.00" or "Free". */
export function formatPromoLabel(
  rule: Pick<DiscountRule, 'fixedPrice' | 'percentOff'>,
  basePrice?: number | null,
  addOnsPerUnit = 0,
): string | null {
  if (rule.fixedPrice != null && rule.fixedPrice > 0) {
    // An amount that covers the whole price takes off the price, not the amount set on the promotion. It reads "Free"
    // only when nothing else is left to pay; with add-ons still charged it shows what really came off.
    if (basePrice != null && basePrice > 0 && rule.fixedPrice >= basePrice) {
      if (addOnsPerUnit > 0) {
        return `Promo -₱${basePrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      return 'Free';
    }

    const amount = rule.fixedPrice.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `Promo -₱${amount}`;
  }

  if (rule.percentOff != null && rule.percentOff > 0) {
    const percent = rule.percentOff.toLocaleString('en-PH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `Promo -${percent}%`;
  }

  return null;
}

/**
 * Of the rules for this product whose add-ons match the item exactly and that have uses left for the quantity, the one
 * with the lowest price. The first rule wins a tie. Null when none applies.
 */
export function findBestDiscount<TRule extends DiscountRule>(
  basePrice: number,
  addOnIds: Iterable<string>,
  rules: readonly TRule[],
  quantity = 1,
): { rule: TRule; price: number } | null {
  const addOnCounts = countAddOns(addOnIds);
  let best: { rule: TRule; price: number } | null = null;

  for (const rule of rules) {
    if (!satisfiesExactAddOns(addOnCounts, rule.addOns)) {
      continue;
    }

    // A promotion with a usage limit only discounts the items it has uses left for.
    if (rule.remaining != null && rule.remaining < quantity) {
      continue;
    }

    const price = calculateDiscountedUnitPrice(basePrice, rule.fixedPrice, rule.percentOff);
    if (price == null) {
      continue;
    }

    if (best == null || price < best.price) {
      best = { rule, price };
    }
  }

  return best;
}
