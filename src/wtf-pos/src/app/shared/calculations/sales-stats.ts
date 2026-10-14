/**
 * Averages and percentages. `average` and `percentOfTotal` are the counterparts of `SalesRules.Average` and
 * `SalesRules.PercentOfTotal` in the API's `WTF.Calculations` project and run the same cases in `calculation-cases.json`.
 */

/** An amount spread over a count (average order value); 0 when there is nothing to divide by. */
export function average(amount: number, count: number): number {
  return count > 0 ? amount / count : 0;
}

/** A share of a total as a percentage from 0 to 100, not rounded; 0 when there is no total to share. */
export function percentOfTotal(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/**
 * How much a figure moved against a previous one, as a whole percentage. A previous figure of 0 counts as +100% when
 * the current one is above 0, otherwise 0%.
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
}
