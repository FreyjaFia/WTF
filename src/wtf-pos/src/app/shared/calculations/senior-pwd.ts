import { fromCents, toCents } from './money';

/**
 * The Senior citizen / PWD discount. This is the TypeScript counterpart of `SeniorPwdRules` in the API's
 * `WTF.Calculations` project; both are tested against the same sample rows in `calculation-cases.json`.
 */
export const SENIOR_PWD_DISCOUNT_RATE = 0.2;
export const SENIOR_PWD_VAT_RATE = 0.12;

/** What the discount does to one covered row (an item, its add-ons and its quantity). */
export interface SeniorPwdAmounts {
  covered: number;
  vatExempt: number;
  discount: number;
}

/** Integer maths for the two rates (20% is 1/5, 1/1.12 is 25/28), so half a centavo rounds up exactly like the API's decimals. */
function discountCents(baseCents: number): number {
  return Math.floor((2 * baseCents + 5) / 10);
}

function netOfVatCents(coveredCents: number): number {
  return Math.floor((50 * coveredCents + 28) / 56);
}

export function seniorPwdAmounts(covered: number, vatRegistered: boolean): SeniorPwdAmounts {
  const coveredCents = toCents(covered);
  if (coveredCents <= 0) {
    return { covered: 0, vatExempt: 0, discount: 0 };
  }

  if (!vatRegistered) {
    return {
      covered: fromCents(coveredCents),
      vatExempt: 0,
      discount: fromCents(discountCents(coveredCents)),
    };
  }

  const netCents = netOfVatCents(coveredCents);
  return {
    covered: fromCents(coveredCents),
    vatExempt: fromCents(coveredCents - netCents),
    discount: fromCents(discountCents(netCents)),
  };
}

/** What the covered rows take off the order total (VAT not charged plus the discount). */
export function seniorPwdReduction(amounts: SeniorPwdAmounts): number {
  return fromCents(toCents(amounts.vatExempt) + toCents(amounts.discount));
}

export function seniorPwdAmountDue(amounts: SeniorPwdAmounts): number {
  return fromCents(toCents(amounts.covered) - toCents(seniorPwdReduction(amounts)));
}

/** Rows add up exactly (in cents). */
export function sumSeniorPwdAmounts(rows: readonly SeniorPwdAmounts[]): SeniorPwdAmounts {
  let covered = 0;
  let vatExempt = 0;
  let discount = 0;
  for (const row of rows) {
    covered += toCents(row.covered);
    vatExempt += toCents(row.vatExempt);
    discount += toCents(row.discount);
  }

  return { covered: fromCents(covered), vatExempt: fromCents(vatExempt), discount: fromCents(discount) };
}

/** A promotion price and a bundle are never covered, and neither is a product marked as not food or drink. */
export function isSeniorPwdEligibleLine(productEligible: boolean, hasPromotion: boolean, isBundle: boolean): boolean {
  return productEligible && !hasPromotion && !isBundle;
}
