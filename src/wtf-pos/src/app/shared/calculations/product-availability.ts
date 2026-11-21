// Mirrors WTF.Calculations.Catalog.ProductAvailability. The API decides what a branch sells; the POS only uses this to
// show "Sold at" and to know which products a branch manager may open for editing.

export function isSoldAt(soldAtBranchIds: readonly string[] | null | undefined, branchId: string): boolean {
  return !soldAtBranchIds || soldAtBranchIds.length === 0 || soldAtBranchIds.includes(branchId);
}

export function isBranchOnly(soldAtBranchIds: readonly string[] | null | undefined): boolean {
  return soldAtBranchIds?.length === 1;
}

export function mayBranchEdit(
  soldAtBranchIds: readonly string[] | null | undefined,
  allowedBranchIds: readonly string[],
): boolean {
  return (
    !!soldAtBranchIds &&
    soldAtBranchIds.length > 0 &&
    soldAtBranchIds.every((id) => allowedBranchIds.includes(id))
  );
}
