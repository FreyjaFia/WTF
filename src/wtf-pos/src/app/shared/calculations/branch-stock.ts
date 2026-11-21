export function branchItemCost(
  branchCost: number | null | undefined,
  averageCost: number | null | undefined,
  costPrice: number | null | undefined,
): number | null {
  return branchCost ?? averageCost ?? costPrice ?? null;
}

export function branchLevel(branchLevel: number | null | undefined, shopLevel: number | null | undefined): number | null {
  return branchLevel ?? shopLevel ?? null;
}
