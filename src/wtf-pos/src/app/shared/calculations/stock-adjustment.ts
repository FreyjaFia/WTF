const QUANTITY_DECIMALS = 1000;

// Rounds half away from zero, like the API, so both sides agree on the last digit.
export function adjustmentDelta(shownQuantity: number, countedQuantity: number): number {
  const difference = countedQuantity - shownQuantity;
  return (
    (Math.sign(difference) * Math.round(Math.abs(difference) * QUANTITY_DECIMALS)) / QUANTITY_DECIMALS
  );
}

export function effectiveQuantity(quantityPerSale: number, allowancePercent: number): number {
  const allowance = Number.isFinite(allowancePercent) && allowancePercent > 0 ? allowancePercent : 0;
  return Math.round(quantityPerSale * (1 + allowance / 100) * QUANTITY_DECIMALS) / QUANTITY_DECIMALS;
}

// How many whole sales the balance covers when each sale takes `perSale`. Zero for an empty or negative balance.
export function salesCovered(balance: number, perSale: number): number {
  if (perSale <= 0 || balance <= 0) {
    return 0;
  }

  const round = (value: number): number => Math.round(value * QUANTITY_DECIMALS) / QUANTITY_DECIMALS;
  return Math.floor(round(balance) / round(perSale));
}
