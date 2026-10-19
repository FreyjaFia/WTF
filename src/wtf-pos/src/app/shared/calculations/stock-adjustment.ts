const QUANTITY_DECIMALS = 1000;

// Rounds half away from zero, like the API, so both sides agree on the last digit.
export function adjustmentDelta(shownQuantity: number, countedQuantity: number): number {
  const difference = countedQuantity - shownQuantity;
  return (
    (Math.sign(difference) * Math.round(Math.abs(difference) * QUANTITY_DECIMALS)) / QUANTITY_DECIMALS
  );
}
