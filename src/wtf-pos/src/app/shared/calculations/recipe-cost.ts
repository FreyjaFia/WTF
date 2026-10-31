import { effectiveQuantity } from './stock-adjustment';

const COST_DECIMALS = 1_000_000;

export interface RecipeCostLine {
  quantityPerSale: number;
  allowancePercent: number;
  unitCost: number | null;
}

export interface RecipeCostSummary {
  totalCost: number;
  unknownCostCount: number;
}

function roundCost(cost: number): number {
  return Math.round(cost * COST_DECIMALS) / COST_DECIMALS;
}

export function lineCost(
  quantityPerSale: number,
  allowancePercent: number,
  unitCost: number,
): number {
  return roundCost(effectiveQuantity(quantityPerSale, allowancePercent) * unitCost);
}

// A line with no cost yet counts as unknown, not free, like the API.
export function recipeCost(lines: RecipeCostLine[], suppliesCost = 0): RecipeCostSummary {
  let total = Math.max(0, suppliesCost);
  let unknown = 0;
  for (const line of lines) {
    if (line.unitCost === null) {
      unknown++;
    } else {
      total += lineCost(line.quantityPerSale, line.allowancePercent, line.unitCost);
    }
  }

  return { totalCost: roundCost(total), unknownCostCount: unknown };
}

export function margin(price: number, cost: number): number {
  return roundCost(price - cost);
}

export function marginPercent(price: number, cost: number): number | null {
  return price > 0 ? Math.round(((price - cost) / price) * 10000) / 100 : null;
}
