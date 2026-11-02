import { addMoney, roundMoney } from './money';
import { margin, marginPercent, recipeCost } from './recipe-cost';
import { effectiveQuantity } from './stock-adjustment';

const QUANTITY_DECIMALS = 1000;

export interface RecipePreviewItemLine {
  itemId: string;
  itemName: string;
  unitName: string;
  quantityPerSale: number;
  allowancePercent: number;
  replacesItemId: string | null;
  unitCost: number | null;
  sizeAmounts: { sizeProductId: string; quantity: number }[];
}

export interface RecipePreviewOptionLink {
  itemId: string;
  itemName: string;
  unitName: string;
  quantityPerSale: number;
  allowancePercent: number;
  replacesItemId: string | null;
  unitCost: number | null;
}

export interface RecipePreviewOption {
  productId: string;
  name: string;
  isSize: boolean;
  price: number;
  links: RecipePreviewOptionLink[];
}

export interface RecipePreviewInput {
  productId: string;
  productName: string;
  price: number;
  suppliesCost: number;
  lines: RecipePreviewItemLine[];
  options: RecipePreviewOption[];
  chosen: Record<string, number>;
}

export interface RecipePreviewLine {
  itemId: string;
  itemName: string;
  unitName: string;
  quantity: number;
  unitCost: number | null;
  lineCost: number | null;
  sourceName: string | null;
}

export interface RecipePreviewResult {
  productId: string;
  productName: string;
  price: number;
  addOnNames: string[];
  lines: RecipePreviewLine[];
  replacedItemNames: string[];
  suppliesCost: number;
  totalCost: number;
  unknownCostCount: number;
  margin: number;
  marginPercent: number | null;
  warnings: string[];
}

interface Part {
  itemId: string;
  productId: string;
  quantity: number;
  replaced: boolean;
}

interface Link {
  productId: string;
  itemId: string;
  quantity: number;
  replacesItemId: string | null;
}

function round(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * QUANTITY_DECIMALS)) / QUANTITY_DECIMALS;
}

function byText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

// The same rule as GetProductRecipePreviewHandler in the API (StockRules.Requirements, then the cost maths): what one sale of
// the drink with the chosen size and add-ons uses and costs, worked out from the lines on screen. It saves nothing, and the API
// stays the authority on the same shared cases.
export function previewRecipe(input: RecipePreviewInput): RecipePreviewResult {
  const ownLines = input.lines.filter((line) => line.itemId && line.quantityPerSale > 0);
  const chosen = input.options.filter((option) => (input.chosen[option.productId] ?? 0) > 0);
  const countOf = (option: RecipePreviewOption): number => input.chosen[option.productId] ?? 0;

  const links: Link[] = [
    ...ownLines.map((line) => ({
      productId: input.productId,
      itemId: line.itemId,
      quantity: effectiveQuantity(line.quantityPerSale, line.allowancePercent),
      replacesItemId: line.replacesItemId,
    })),
    ...chosen.flatMap((option) =>
      option.links.map((link) => ({
        productId: option.productId,
        itemId: link.itemId,
        quantity: effectiveQuantity(link.quantityPerSale, link.allowancePercent),
        replacesItemId: link.replacesItemId,
      })),
    ),
  ];
  const linksByProduct = new Map<string, Link[]>();
  for (const link of links) {
    linksByProduct.set(link.productId, [...(linksByProduct.get(link.productId) ?? []), link]);
  }

  const sizeAmounts = ownLines.flatMap((line) =>
    line.sizeAmounts.map((amount) => ({ ...amount, itemId: line.itemId })),
  );

  const replaced = new Set<string>();
  for (const option of chosen) {
    for (const link of linksByProduct.get(option.productId) ?? []) {
      if (link.replacesItemId) {
        replaced.add(link.replacesItemId);
      }
    }
  }

  const ownSizeIds = new Set(chosen.map((option) => option.productId));
  const flat = new Map<string, number>();
  for (const amount of [...sizeAmounts].sort((a, b) => byText(a.sizeProductId, b.sizeProductId))) {
    if (ownSizeIds.has(amount.sizeProductId) && !flat.has(amount.itemId)) {
      flat.set(amount.itemId, amount.quantity);
    }
  }

  const parts: Part[] = [];
  for (const link of linksByProduct.get(input.productId) ?? []) {
    if (replaced.has(link.itemId)) {
      parts.push({ itemId: link.itemId, productId: link.productId, quantity: 0, replaced: true });
      continue;
    }

    const flatQuantity = flat.get(link.itemId);
    if (flatQuantity !== undefined) {
      flat.delete(link.itemId);
      parts.push({
        itemId: link.itemId,
        productId: link.productId,
        quantity: flatQuantity,
        replaced: flatQuantity === 0,
      });
      continue;
    }

    parts.push({ itemId: link.itemId, productId: link.productId, quantity: link.quantity, replaced: false });
  }

  for (const [itemId, flatQuantity] of flat) {
    if (!replaced.has(itemId)) {
      parts.push({ itemId, productId: input.productId, quantity: flatQuantity, replaced: flatQuantity === 0 });
    }
  }

  for (const option of chosen) {
    for (const link of linksByProduct.get(option.productId) ?? []) {
      parts.push({
        itemId: link.itemId,
        productId: option.productId,
        quantity: link.quantity * countOf(option),
        replaced: false,
      });
    }
  }

  const grouped = new Map<string, { itemId: string; productId: string; quantity: number; keepAtZero: boolean }>();
  for (const part of parts) {
    const key = `${part.itemId}|${part.productId}`;
    const group = grouped.get(key) ?? {
      itemId: part.itemId,
      productId: part.productId,
      quantity: 0,
      keepAtZero: false,
    };
    group.quantity += part.quantity;
    group.keepAtZero = group.keepAtZero || part.replaced;
    grouped.set(key, group);
  }

  const itemInfo = new Map<string, { name: string; unitName: string; unitCost: number | null }>();
  for (const line of ownLines) {
    itemInfo.set(line.itemId, { name: line.itemName, unitName: line.unitName, unitCost: line.unitCost });
  }

  for (const option of chosen) {
    for (const link of option.links) {
      if (!itemInfo.has(link.itemId)) {
        itemInfo.set(link.itemId, { name: link.itemName, unitName: link.unitName, unitCost: link.unitCost });
      }
    }
  }

  const sourceNameOf = (productId: string): string | null =>
    productId === input.productId
      ? null
      : (input.options.find((option) => option.productId === productId)?.name ?? null);

  const lines: RecipePreviewLine[] = [];
  const replacedNames: string[] = [];
  for (const group of grouped.values()) {
    const quantity = round(group.quantity);
    if (quantity <= 0 && !group.keepAtZero) {
      continue;
    }

    const info = itemInfo.get(group.itemId);
    if (!info) {
      continue;
    }

    if (quantity <= 0) {
      replacedNames.push(info.name);
      continue;
    }

    lines.push({
      itemId: group.itemId,
      itemName: info.name,
      unitName: info.unitName,
      quantity,
      unitCost: info.unitCost,
      lineCost:
        info.unitCost === null
          ? null
          : recipeCost([{ quantityPerSale: quantity, allowancePercent: 0, unitCost: info.unitCost }], 0)
              .totalCost,
      sourceName: sourceNameOf(group.productId),
    });
  }

  lines.sort((a, b) => {
    const aSource = a.sourceName !== null ? 1 : 0;
    const bSource = b.sourceName !== null ? 1 : 0;
    return (
      aSource - bSource ||
      byText(a.sourceName ?? '', b.sourceName ?? '') ||
      byText(a.itemName, b.itemName)
    );
  });

  const supplies = input.suppliesCost >= 0 ? input.suppliesCost : 0;
  const summary = recipeCost(
    lines.map((line) => ({ quantityPerSale: line.quantity, allowancePercent: 0, unitCost: line.unitCost })),
    supplies,
  );
  const price = roundMoney(
    addMoney(input.price, ...chosen.map((option) => roundMoney(option.price * countOf(option)))),
  );

  const warnings: string[] = [];
  if (sizeAmounts.length > 0) {
    warnings.push(
      ...chosen
        .filter(
          (option) =>
            option.isSize && sizeAmounts.every((amount) => amount.sizeProductId !== option.productId),
        )
        .map((option) => `${option.name} has no amounts of its own, so it uses the base amounts.`),
    );
  }

  return {
    productId: input.productId,
    productName: input.productName,
    price,
    addOnNames: chosen.map((option) =>
      countOf(option) > 1 ? `${option.name} x${countOf(option)}` : option.name,
    ),
    lines,
    replacedItemNames: [...new Set(replacedNames)].sort(byText),
    suppliesCost: supplies,
    totalCost: summary.totalCost,
    unknownCostCount: summary.unknownCostCount,
    margin: margin(price, summary.totalCost),
    marginPercent: marginPercent(price, summary.totalCost),
    warnings,
  };
}
