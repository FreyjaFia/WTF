const QUANTITY_DECIMALS = 1000;

function roundQuantity(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * QUANTITY_DECIMALS)) / QUANTITY_DECIMALS;
}

// No limit means waste never needs review; a limit of zero sends every entry to review.
export function wasteNeedsReview(quantity: number, limit: number | null | undefined): boolean {
  if (limit === null || limit === undefined) {
    return false;
  }

  return roundQuantity(quantity) > roundQuantity(limit);
}

// Rounds half away from zero to three decimals, like the API.
export function wasteBalanceAfter(balance: number, quantity: number): number {
  return roundQuantity(roundQuantity(balance) - roundQuantity(quantity));
}

// How much the balance is short of the waste. Zero when the balance covers it.
export function wasteShortfall(balance: number, quantity: number): number {
  const after = wasteBalanceAfter(balance, quantity);
  return after < 0 ? roundQuantity(Math.min(-after, roundQuantity(quantity))) : 0;
}
