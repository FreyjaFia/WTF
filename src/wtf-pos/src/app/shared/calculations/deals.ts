import { addOnsTotal, priceWithAddOns } from './order-pricing';
import { calculateDiscountedUnitPrice, formatPromoLabel } from './promotion-pricing';

/** One discount rule as a screen gets it: the product, the exact add-ons it needs and what comes off. */
export interface DealSource {
  productId: string;
  fixedPrice?: number | null;
  percentOff?: number | null;
  addOns: readonly { addOnProductId: string; quantity: number }[];
  /** How many more items the promotion can discount. Missing or null means no usage limit. */
  remaining?: number | null;
}

export interface DealProduct {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
}

/** The add-on as it is priced for this product (an override already applied). */
export interface DealAddOn {
  id: string;
  name: string;
  price: number;
}

export interface Deal {
  /** Same product, add-ons and discount: one card, whichever promotion it comes from. */
  key: string;
  productId: string;
  productName: string;
  imageUrl: string | null;
  addOns: { id: string; name: string; price: number; quantity: number }[];
  /** The name a customer reads: "Latte + Small". */
  title: string;
  listPrice: number;
  price: number;
  label: string | null;
  /** True when the promotion has a usage limit, so the price is confirmed when the shop completes the order. */
  limited: boolean;
}

/**
 * Turns the discount rules that are on right now into cards a customer can pick: the product with exactly the add-ons
 * the rule needs, priced as the shop will charge it. A rule is left out when its product or one of its add-ons cannot
 * be found (the menu moved on), when it has no uses left, or when it takes nothing off. Cheapest first among cards
 * for the same product and add-ons.
 */
export function buildDeals(
  sources: readonly DealSource[],
  findProduct: (productId: string) => DealProduct | undefined,
  findAddOn: (productId: string, addOnProductId: string) => DealAddOn | undefined,
): Deal[] {
  const byKey = new Map<string, Deal>();

  for (const source of sources) {
    if (source.remaining != null && source.remaining <= 0) {
      continue;
    }

    const product = findProduct(source.productId);
    if (!product) {
      continue;
    }

    const addOns: Deal['addOns'] = [];
    let complete = true;
    for (const required of source.addOns) {
      const addOn = findAddOn(product.id, required.addOnProductId);
      if (!addOn) {
        complete = false;
        break;
      }

      addOns.push({ id: addOn.id, name: addOn.name, price: addOn.price, quantity: required.quantity });
    }

    if (!complete) {
      continue;
    }

    const discounted = calculateDiscountedUnitPrice(product.price, source.fixedPrice, source.percentOff);
    if (discounted == null || discounted >= product.price) {
      continue;
    }

    const key = [product.id, ...addOns.map((a) => `${a.id}x${a.quantity}`).sort()].join('|');
    const deal: Deal = {
      key,
      productId: product.id,
      productName: product.name,
      imageUrl: product.imageUrl ?? null,
      addOns,
      title: [
        product.name,
        ...addOns.map((a) => (a.quantity > 1 ? `${a.quantity} ${a.name}` : a.name)),
      ].join(' + '),
      listPrice: priceWithAddOns(product.price, addOns),
      price: priceWithAddOns(discounted, addOns),
      label: formatPromoLabel(source, product.price, addOnsTotal(addOns)),
      limited: source.remaining != null,
    };

    const existing = byKey.get(key);
    if (!existing || deal.price < existing.price) {
      byKey.set(key, deal);
    }
  }

  return [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** What the add-ons of a deal add to the price of one item. Exposed for screens that show the breakdown. */
export function dealAddOnsTotal(deal: Pick<Deal, 'addOns'>): number {
  return addOnsTotal(deal.addOns);
}
