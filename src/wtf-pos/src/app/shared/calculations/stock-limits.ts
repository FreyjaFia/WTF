const QUANTITY_DECIMALS = 1000;

export interface StockLimitItem {
  id: string;
  name: string;
  unitName: string;
  balance: number;
}

export interface StockLimitLink {
  productId: string;
  itemId: string;
  quantityPerSale: number;
  scalesWithSize?: boolean;
  replacesItemId?: string | null;
}

export interface StockSizeMultiplier {
  productId: string;
  multiplier: number;
}

export interface StockCartAddOn {
  productId: string;
  quantity: number;
}

// One line of the cart as the server will see it. `key` ties the line back to what is on screen.
export interface StockCartLine {
  key: string;
  productId: string;
  quantity: number;
  addOns?: StockCartAddOn[];
}

export interface StockShortfall {
  itemId: string;
  needed: number;
  balance: number;
  short: number;
  lineKeys: string[];
}

function round(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * QUANTITY_DECIMALS)) / QUANTITY_DECIMALS;
}

// The same rule as StockRules.Shortfalls in the API: what the cart cannot get from the items that block sales when they
// run short. Needs are summed per item across all lines, and an add-on takes its item once per unit of the drink it is on.
// `items` holds only the blocking items; products linked to any other item are left out. The server stays the authority.
export function stockShortfalls(
  lines: readonly StockCartLine[],
  links: readonly StockLimitLink[],
  items: readonly Pick<StockLimitItem, 'id' | 'balance'>[],
  multipliers: readonly StockSizeMultiplier[] = [],
): StockShortfall[] {
  const balanceByItem = new Map(items.map((item) => [item.id, item.balance]));
  const multiplierByProduct = new Map(multipliers.map((m) => [m.productId, m.multiplier]));
  const allLinksByProduct = new Map<string, StockLimitLink[]>();
  for (const link of links) {
    allLinksByProduct.set(link.productId, [...(allLinksByProduct.get(link.productId) ?? []), link]);
  }

  const parts = new Map<string, { itemId: string; quantity: number; lineKeys: Set<string> }>();
  const take = (productId: string, units: number, scale: number, replaced: ReadonlySet<string>, lineKey: string): void => {
    for (const link of allLinksByProduct.get(productId) ?? []) {
      if (!balanceByItem.has(link.itemId) || replaced.has(link.itemId)) {
        continue;
      }

      const key = `${link.itemId}|${productId}`;
      const part = parts.get(key) ?? { itemId: link.itemId, quantity: 0, lineKeys: new Set<string>() };
      part.quantity += link.quantityPerSale * (link.scalesWithSize ? scale : 1) * units;
      part.lineKeys.add(lineKey);
      parts.set(key, part);
    }
  };

  for (const line of lines) {
    const addOns = line.addOns ?? [];
    let scale = 1;
    const replaced = new Set<string>();
    for (const addOn of addOns) {
      scale *= multiplierByProduct.get(addOn.productId) ?? 1;
      for (const link of allLinksByProduct.get(addOn.productId) ?? []) {
        if (link.replacesItemId) {
          replaced.add(link.replacesItemId);
        }
      }
    }

    take(line.productId, line.quantity, scale, replaced, line.key);
    for (const addOn of addOns) {
      take(addOn.productId, addOn.quantity * line.quantity, scale, new Set<string>(), line.key);
    }
  }

  const needByItem = new Map<string, { needed: number; lineKeys: Set<string> }>();
  for (const part of parts.values()) {
    const current = needByItem.get(part.itemId) ?? { needed: 0, lineKeys: new Set<string>() };
    current.needed += round(part.quantity);
    part.lineKeys.forEach((lineKey) => current.lineKeys.add(lineKey));
    needByItem.set(part.itemId, current);
  }

  const shortfalls: StockShortfall[] = [];
  for (const [itemId, need] of needByItem) {
    const balance = balanceByItem.get(itemId) ?? 0;
    const needed = round(need.needed);
    const short = Math.max(0, round(needed - Math.max(0, balance)));
    if (short > 0) {
      shortfalls.push({ itemId, needed, balance, short, lineKeys: [...need.lineKeys] });
    }
  }

  return shortfalls;
}
