import type { CartItemDto } from '../models/cart.models';
import { ADD_ON_TYPE_ORDER } from '../models/product.models';
import { fromCents, toCents } from './money';

/**
 * The "+ and -" list under an order line: the price of the item, what each add-on adds, what a promotion takes off.
 * Every screen that explains a line (staff cart, order details, receipt image, customer cart, customer orders) builds
 * it here and draws it with `app-line-breakdown`, so the wording, the order and the arithmetic cannot differ. The rows
 * always add up: the base row plus the add-on rows minus the discount row is the line total.
 */

const UNKNOWN_ADD_ON_RANK = 99;

/** An add-on as any screen holds it: staff carts list one entry per unit, the customer cart lists it once with a count. */
export interface BreakdownAddOn {
  addOnId: string;
  name: string;
  price: number;
  quantity?: number | null;
  addOnType?: number | null;
}

export interface GroupedAddOn {
  addOnId: string;
  name: string;
  price: number;
  /** How many of it one item carries. */
  countPerItem: number;
}

export interface BreakdownDiscount {
  /** What the promotion takes off the whole line. */
  amount: number;
  /** The label saved with the promotion, for example "Promo -10%" or "Free". */
  label?: string | null;
}

export interface BreakdownInput {
  qty: number;
  /** The price of one item before any promotion and without add-ons. */
  listUnitPrice: number;
  addOns?: readonly BreakdownAddOn[] | null;
  discount?: BreakdownDiscount | null;
}

export type BreakdownRowKind = 'base' | 'addOn' | 'discount';

export interface BreakdownRow {
  kind: BreakdownRowKind;
  label: string;
  /** The working behind the amount, for example "₱30.00 × 2". */
  detail: string | null;
  /** Signed: add-ons that cost money are positive, a discount is negative. The base row is always positive. */
  amount: number;
}

export interface LineBreakdown {
  /** Empty when the line has no add-on and no promotion: the price and quantity on the line say it all. */
  rows: BreakdownRow[];
  total: number;
}

export function formatPeso(amount: number): string {
  return `₱${Math.abs(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "3x Latte" -> "latte", so a name sorts the same with or without its quantity in front. */
export function normalizeSortLabel(value: string): string {
  return value.replace(/^\s*\d+\s*x\s+/i, '').trim().toLowerCase();
}

function rankOf(addOnType: number | null | undefined): number {
  if (addOnType == null) {
    return UNKNOWN_ADD_ON_RANK;
  }

  return (ADD_ON_TYPE_ORDER as Record<number, number>)[addOnType] ?? UNKNOWN_ADD_ON_RANK;
}

/** Merges repeats of the same add-on at the same price and orders them Size, Flavor, Sauce, Topping, Extra, then by name. */
export function groupAddOns(addOns: readonly BreakdownAddOn[] | null | undefined): GroupedAddOn[] {
  const grouped = new Map<string, GroupedAddOn & { rank: number }>();

  for (const addOn of addOns ?? []) {
    const key = `${addOn.addOnId}::${addOn.price}`;
    const count = Math.max(1, addOn.quantity ?? 1);
    const current = grouped.get(key);

    if (current) {
      current.countPerItem += count;
      continue;
    }

    grouped.set(key, {
      addOnId: addOn.addOnId,
      name: addOn.name,
      price: addOn.price,
      countPerItem: count,
      rank: rankOf(addOn.addOnType),
    });
  }

  return [...grouped.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank || normalizeSortLabel(a.name).localeCompare(normalizeSortLabel(b.name)),
    )
    .map(({ addOnId, name, price, countPerItem }) => ({ addOnId, name, price, countPerItem }));
}

/** "2x Latte" for more than one, the bare name for one. The one wording for a counted name everywhere. */
export function countedName(name: string, count: number): string {
  return count > 1 ? `${count}x ${name}` : name;
}

/**
 * Says what a saved promotion label means in words, for the discount row: "Promo -10%" -> "10% off",
 * "Promo -₱5.00" -> "₱5.00 off", "Free" -> "Free". Anything else is shown as it was saved.
 */
export function describePromoLabel(label: string | null | undefined): string | null {
  const text = label?.trim();
  if (!text) {
    return null;
  }

  const match = /^promo\s*-\s*(.+)$/i.exec(text);
  return match ? `${match[1]} off` : text;
}

/** The price of one item before the promotion, from the price it was charged. Exact: the discount covers whole items. */
export function listUnitPriceOf(chargedUnitPrice: number, discountAmount: number | null | undefined, qty: number): number {
  if (!discountAmount || qty <= 0) {
    return chargedUnitPrice;
  }

  return fromCents(toCents(chargedUnitPrice) + Math.round(toCents(discountAmount) / qty));
}

export function buildLineBreakdown(input: BreakdownInput): LineBreakdown {
  const qty = Math.max(1, input.qty);
  const baseCents = toCents(input.listUnitPrice) * qty;
  const addOnRows: BreakdownRow[] = groupAddOns(input.addOns).map((addOn) => {
    const units = addOn.countPerItem * qty;
    return {
      kind: 'addOn',
      label: addOn.name,
      detail: units > 1 ? `${formatPeso(addOn.price)} × ${units}` : null,
      amount: fromCents(toCents(addOn.price) * units),
    };
  });

  const discountCents = input.discount?.amount ? toCents(input.discount.amount) : 0;
  const discountRows: BreakdownRow[] =
    discountCents > 0
      ? [
          {
            kind: 'discount',
            label: 'Promo discount',
            detail: describePromoLabel(input.discount?.label),
            amount: fromCents(-discountCents),
          },
        ]
      : [];

  const modifiers = [...addOnRows, ...discountRows];
  const totalCents =
    baseCents + modifiers.reduce((sum, row) => sum + toCents(row.amount), 0);

  if (modifiers.length === 0) {
    return { rows: [], total: fromCents(totalCents) };
  }

  const base: BreakdownRow = {
    kind: 'base',
    label: 'Price',
    detail: qty > 1 ? `${qty} × ${formatPeso(input.listUnitPrice)}` : null,
    amount: fromCents(baseCents),
  };

  return { rows: [base, ...modifiers], total: fromCents(totalCents) };
}

/**
 * The breakdown of a cart line as order details and the receipt hold it: `price` is what one item was charged,
 * `originalPrice` (when a promotion applied) is the list price, and `promoDiscount` is what came off the whole line.
 */
export function breakdownOfCartItem(
  item: Pick<CartItemDto, 'qty' | 'price' | 'originalPrice' | 'addOns' | 'promoDiscount' | 'promoLabel'>,
): LineBreakdown {
  return buildLineBreakdown({
    qty: item.qty,
    listUnitPrice: item.originalPrice ?? item.price,
    addOns: item.addOns,
    discount: item.promoDiscount ? { amount: item.promoDiscount, label: item.promoLabel } : null,
  });
}
