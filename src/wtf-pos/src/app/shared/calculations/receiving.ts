import { fromCents, roundMoney, toCents } from './money';

const COST_DECIMALS = 1_000_000;
const QUANTITY_DECIMALS = 1000;

// Rounds half away from zero like the API's decimal rounding.
function roundHalfAwayFromZero(value: number, scale: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale;
}

export function unitsFromPacks(packs: number, unitsPerPack: number): number {
  return roundHalfAwayFromZero(packs * unitsPerPack, QUANTITY_DECIMALS);
}

export function packUnitCost(packPrice: number | null, unitsPerPack: number): number | null {
  if (packPrice === null || !(unitsPerPack > 0)) {
    return null;
  }

  return roundHalfAwayFromZero(packPrice / unitsPerPack, COST_DECIMALS);
}

export function receiptLineTotal(packs: number, packPrice: number | null): number | null {
  return packPrice === null ? null : roundMoney(packs * packPrice);
}

export function invoiceDifference(
  invoiceTotal: number | null,
  lineTotals: readonly (number | null)[],
): number | null {
  if (invoiceTotal === null || lineTotals.some((total) => total === null)) {
    return null;
  }

  const linesCents = lineTotals.reduce<number>((sum, total) => sum + toCents(total as number), 0);
  return fromCents(toCents(invoiceTotal) - linesCents);
}
