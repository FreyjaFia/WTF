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
  /** The most items one order may get at this promotion's price. Missing means no limit per order. */
  maxPerOrder?: number | null;
  /** Rules of one promotion share its limits: the same key means the same promotion. Missing, the rule stands alone. */
  promotionKey?: string | null;
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

/** A discount found for a line: the rule, its unit price, and how many of the requested items it covers. */
export interface DiscountMatch<TRule extends DiscountRule = DiscountRule> {
  rule: TRule;
  price: number;
  /** How many items get the discounted price. Less than `requested` when a limit covers only part of the line. */
  quantity: number;
  requested: number;
}

/**
 * What the promotions can still discount for ONE order, shared by all its lines. A promotion's allowance is the smaller
 * of the uses nobody holds yet and the most one order may take; a line takes from it.
 */
export class DiscountAllowance {
  private readonly left = new Map<unknown, number>();

  /** How many more items the rule's promotion can discount in this order; Infinity when nothing limits it. */
  public available(rule: DiscountRule): number {
    const key = this.keyOf(rule);
    if (!this.left.has(key)) {
      this.left.set(key, Math.min(rule.remaining ?? Infinity, rule.maxPerOrder ?? Infinity));
    }

    return Math.max(0, this.left.get(key) ?? Infinity);
  }

  public use(rule: DiscountRule, quantity: number): void {
    const key = this.keyOf(rule);
    this.available(rule);
    this.left.set(key, (this.left.get(key) ?? Infinity) - quantity);
  }

  private keyOf(rule: DiscountRule): unknown {
    return rule.promotionKey ?? rule;
  }
}

/**
 * Of the rules for this product whose add-ons match the item exactly, the one that saves the most on the line. A limit
 * (uses left, the most one order may have) covers only as many items as it allows, and the rest pay the list price, so
 * the saving is the discount per item times the items covered. At the same saving the lower price wins, then the first
 * rule. Null when no rule applies.
 */
export function findBestDiscount<TRule extends DiscountRule>(
  basePrice: number,
  addOnIds: Iterable<string>,
  rules: readonly TRule[],
  quantity = 1,
  allowance: DiscountAllowance = new DiscountAllowance(),
): DiscountMatch<TRule> | null {
  const addOnCounts = countAddOns(addOnIds);
  let best: DiscountMatch<TRule> | null = null;
  let bestSavingCents = -1;

  for (const rule of rules) {
    if (!satisfiesExactAddOns(addOnCounts, rule.addOns)) {
      continue;
    }

    const covered = Math.min(quantity, allowance.available(rule));
    if (covered <= 0) {
      continue;
    }

    const price = calculateDiscountedUnitPrice(basePrice, rule.fixedPrice, rule.percentOff);
    if (price == null) {
      continue;
    }

    const savingCents = (toCents(basePrice) - toCents(price)) * covered;
    if (best == null || savingCents > bestSavingCents || (savingCents === bestSavingCents && price < best.price)) {
      best = { rule, price, quantity: covered, requested: quantity };
      bestSavingCents = savingCents;
    }
  }

  return best;
}

/** A cart line as discounts see it. */
export interface AllocationLine {
  productId: string;
  basePrice: number;
  /** One id per add-on, repeated for its quantity. */
  addOnIds: readonly string[];
  quantity: number;
  /** False for lines that never get a discounted-product price (a bundle line). */
  eligible: boolean;
}

/**
 * Gives each line of a cart its discount, in order, sharing the promotions' allowances: a promotion that can discount
 * 3 items covers 3 across the whole order, however many lines use it.
 */
export function allocateDiscounts<TRule extends DiscountRule>(
  lines: readonly AllocationLine[],
  rulesFor: (productId: string) => readonly TRule[],
): (DiscountMatch<TRule> | null)[] {
  const allowance = new DiscountAllowance();

  return lines.map((line) => {
    if (!line.eligible) {
      return null;
    }

    const match = findBestDiscount(line.basePrice, line.addOnIds, rulesFor(line.productId), line.quantity, allowance);
    if (match) {
      allowance.use(match.rule, match.quantity);
    }

    return match;
  });
}
