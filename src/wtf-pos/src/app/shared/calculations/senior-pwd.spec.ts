import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { PricedLine, lineTotal } from './order-pricing';
import {
  SeniorPwdAmounts,
  isSeniorPwdEligibleLine,
  seniorPwdAmountDue,
  seniorPwdAmounts,
  seniorPwdReduction,
  sumSeniorPwdAmounts,
} from './senior-pwd';
import { subtractMoney, sumAmounts } from './money';

interface RowCase {
  name: string;
  covered: number;
  vatRegistered: boolean;
  expectedVatExempt: number;
  expectedDiscount: number;
  expectedDue: number;
}

interface OrderCase {
  name: string;
  vatRegistered: boolean;
  lines: { quantity: number; price: number; addOns: { price: number; quantity: number }[]; covered: boolean }[];
  expectedTotal: number;
  expectedRows: { covered: number; vatExempt: number; discount: number }[];
}

interface EligibilityCase {
  name: string;
  productEligible: boolean;
  hasPromotion: boolean;
  isBundle: boolean;
  expected: boolean;
}

describe('senior / PWD discount (shared cases)', () => {
  it.each((cases.seniorPwdRow as RowCase[]).map((c) => [c.name, c] as const))('row: %s', (_name, c) => {
    const amounts = seniorPwdAmounts(c.covered, c.vatRegistered);

    expect(amounts.vatExempt).toBe(c.expectedVatExempt);
    expect(amounts.discount).toBe(c.expectedDiscount);
    expect(seniorPwdAmountDue(amounts)).toBe(c.expectedDue);
  });

  it.each((cases.seniorPwdOrders as OrderCase[]).map((c) => [c.name, c] as const))('order: %s', (_name, c) => {
    const priced: PricedLine[] = c.lines.map((line) => ({ qty: line.quantity, price: line.price, addOns: line.addOns }));
    const rows: SeniorPwdAmounts[] = priced
      .filter((_line, index) => c.lines[index].covered)
      .map((line) => seniorPwdAmounts(lineTotal(line), c.vatRegistered));
    const total = subtractMoney(
      sumAmounts(priced.map((line) => lineTotal(line))),
      sumAmounts(rows.map((row) => seniorPwdReduction(row))),
    );

    expect(total).toBe(c.expectedTotal);
    expect(rows).toEqual(c.expectedRows);
    expect(sumSeniorPwdAmounts(rows).covered).toBe(sumAmounts(c.expectedRows.map((row) => row.covered)));
  });

  it.each((cases.seniorPwdEligibility as EligibilityCase[]).map((c) => [c.name, c] as const))(
    'eligibility: %s',
    (_name, c) => {
      expect(isSeniorPwdEligibleLine(c.productEligible, c.hasPromotion, c.isBundle)).toBe(c.expected);
    },
  );
});
