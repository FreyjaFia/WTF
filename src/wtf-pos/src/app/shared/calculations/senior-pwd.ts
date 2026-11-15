import type { CartItemDto } from '../models/cart.models';
import { fromCents, subtractMoney, toCents } from './money';
import { LineDiscount, cartTotal, lineTotal } from './order-pricing';

// TypeScript counterpart of `SeniorPwdRules` in the API's `WTF.Calculations`; both use the same rows in `calculation-cases.json`.
export const SENIOR_PWD_DISCOUNT_RATE = 0.2;
export const SENIOR_PWD_DISCOUNT_PERCENT = Math.round(SENIOR_PWD_DISCOUNT_RATE * 100);
export const SENIOR_PWD_VAT_RATE = 0.12;

export interface SeniorPwdAmounts {
  covered: number;
  vatExempt: number;
  discount: number;
}

// Integer maths for the two rates (20% is 1/5, 1/1.12 is 25/28), so half a centavo rounds up exactly like the API's decimals.
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

export function seniorPwdReduction(amounts: SeniorPwdAmounts): number {
  return fromCents(toCents(amounts.vatExempt) + toCents(amounts.discount));
}

export function seniorPwdAmountDue(amounts: SeniorPwdAmounts): number {
  return fromCents(toCents(amounts.covered) - toCents(seniorPwdReduction(amounts)));
}

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

export function isSeniorPwdEligibleLine(productEligible: boolean, hasPromotion: boolean, isBundle: boolean): boolean {
  return productEligible && !hasPromotion && !isBundle;
}

export interface SeniorPwdPersonTotals extends SeniorPwdAmounts {
  amountDue: number;
}

export function isCoveredLine(line: Pick<CartItemDto, 'seniorPwdPersonIndex'>): boolean {
  return line.seniorPwdPersonIndex !== null && line.seniorPwdPersonIndex !== undefined;
}

export function rowAmounts(cart: readonly CartItemDto[], vatRegistered: boolean): (SeniorPwdAmounts | null)[] {
  return cart.map((line) => (isCoveredLine(line) ? seniorPwdAmounts(lineTotal(line), vatRegistered) : null));
}

export function reductionOf(cart: readonly CartItemDto[], vatRegistered: boolean): number {
  let cents = 0;
  for (const amounts of rowAmounts(cart, vatRegistered)) {
    cents += amounts ? toCents(seniorPwdReduction(amounts)) : 0;
  }

  return fromCents(cents);
}

export function totalsByPerson(
  cart: readonly CartItemDto[],
  personCount: number,
  vatRegistered: boolean,
): SeniorPwdPersonTotals[] {
  const rows = rowAmounts(cart, vatRegistered);
  return Array.from({ length: personCount }, (_, personIndex) => {
    const own = rows.filter((_row, lineIndex) => cart[lineIndex].seniorPwdPersonIndex === personIndex);
    const sum = sumSeniorPwdAmounts(own.filter((row): row is SeniorPwdAmounts => row !== null));
    return { ...sum, amountDue: seniorPwdAmountDue(sum) };
  });
}

export function lineNetTotal(total: number, reduction: number): number {
  return subtractMoney(total, reduction);
}

export function cartTotalAfterSeniorPwd(
  cart: readonly CartItemDto[],
  vatRegistered: boolean,
  discountOf: (line: CartItemDto) => LineDiscount | null = () => null,
): number {
  return subtractMoney(cartTotal(cart, discountOf), reductionOf(cart, vatRegistered));
}
