import { fromCents, toCents } from './money';

/**
 * Order and cart totals. This is the TypeScript counterpart of `OrderMetrics` in the API's `WTF.Calculations` project;
 * both are tested against the same sample orders in `calculation-cases.json`, so a change to one that is not made to
 * the other fails a test.
 *
 * The API stays the authority: it recomputes the total whenever an order is saved. These functions only show totals
 * while a cart is being built (no round trip per tap, and the POS must work offline) and break a saved order into lines.
 */

/** One add-on on a line. `quantity` is how many of it per item; carts that list each add-on once leave it out (1). */
export interface PricedAddOn {
  price: number;
  quantity?: number | null;
}

/** A cart line. A bundle line (it has `bundleItems`) is sold at its own `price`; the items inside add nothing. */
export interface PricedLine {
  qty: number;
  price: number;
  addOns?: readonly PricedAddOn[] | null;
  bundleItems?: readonly unknown[] | null;
}

export function isBundleLine(line: Pick<PricedLine, 'bundleItems'>): boolean {
  return (line.bundleItems?.length ?? 0) > 0;
}

/** What the add-ons add to the price of one item. */
export function addOnsTotal(addOns: readonly PricedAddOn[] | null | undefined): number {
  let cents = 0;
  for (const addOn of addOns ?? []) {
    cents += toCents(addOn.price) * (addOn.quantity ?? 1);
  }

  return fromCents(cents);
}

/** The price of one item with its add-ons. */
export function priceWithAddOns(basePrice: number, addOns?: readonly PricedAddOn[] | null): number {
  return fromCents(toCents(basePrice) + toCents(addOnsTotal(addOns)));
}

/** A unit price times how many were bought. */
export function extendedPrice(unit: number, quantity: number): number {
  return fromCents(toCents(unit) * quantity);
}

/**
 * The price of one item of a cart line. A discounted product passes its discounted price as `basePrice`; a bundle line
 * ignores both add-ons and discount.
 */
export function lineUnitSubtotal(line: PricedLine, basePrice: number | null = null): number {
  if (isBundleLine(line)) {
    return line.price;
  }

  return priceWithAddOns(basePrice ?? line.price, line.addOns);
}

export function lineTotal(line: PricedLine, basePrice: number | null = null): number {
  return extendedPrice(lineUnitSubtotal(line, basePrice), line.qty);
}

/** A discount on part of a line: this many items are charged `price` as their base, the rest pay the list price. */
export interface LineDiscount {
  price: number;
  quantity: number;
}

/** A line total when only `discount.quantity` of its items get the discounted base price. */
export function discountedLineTotal(line: PricedLine, discount: LineDiscount | null): number {
  if (!discount || isBundleLine(line)) {
    return lineTotal(line);
  }

  const covered = Math.min(line.qty, Math.max(0, discount.quantity));
  const cents =
    toCents(lineUnitSubtotal(line, discount.price)) * covered +
    toCents(lineUnitSubtotal(line)) * (line.qty - covered);
  return fromCents(cents);
}

export function cartTotal<TLine extends PricedLine>(
  lines: readonly TLine[],
  discountOf: (line: TLine) => LineDiscount | null = () => null,
): number {
  let cents = 0;
  for (const line of lines) {
    cents += toCents(discountedLineTotal(line, discountOf(line)));
  }

  return fromCents(cents);
}

/** A line of a saved order as the API returns it. Unpriced lines (a missing price) count as 0. */
export interface SavedOrderLine {
  price?: number | null;
  quantity: number;
  addOns: readonly { price?: number | null; quantity: number }[];
}

export function savedLineTotal(line: SavedOrderLine): number {
  return extendedPrice(
    priceWithAddOns(
      line.price ?? 0,
      line.addOns.map((addOn) => ({ price: addOn.price ?? 0, quantity: addOn.quantity })),
    ),
    line.quantity,
  );
}

/** What a promotion took off a line: the list price minus what was charged, per item, never below zero. */
export function promoDiscount(listPrice: number, chargedPrice: number, quantity: number): number {
  const perItem = Math.max(0, toCents(listPrice) - toCents(chargedPrice));
  return fromCents(perItem * quantity);
}
