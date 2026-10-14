/**
 * Prices are pesos with at most two decimals. Adding them as floating point numbers drifts (0.1 + 0.2), while the API
 * adds them as exact decimals. Every calculation in this folder therefore works in whole cents and converts back at
 * the end, so the app and the API agree to the centavo.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Adds amounts exactly (in cents) and returns pesos. */
export function sumAmounts(amounts: Iterable<number>): number {
  let cents = 0;
  for (const amount of amounts) {
    cents += toCents(amount);
  }

  return fromCents(cents);
}

/** Rounds to the centavo. */
export function roundMoney(amount: number): number {
  return fromCents(toCents(amount));
}

/** Adds amounts exactly. */
export function addMoney(...amounts: number[]): number {
  return sumAmounts(amounts);
}

/** `minuend - subtrahend`, exactly. Negative when the second is larger. */
export function subtractMoney(minuend: number, subtrahend: number): number {
  return fromCents(toCents(minuend) - toCents(subtrahend));
}
