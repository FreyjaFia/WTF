import { describe, expect, it } from 'vitest';
import { PricedLine, lineTotal } from './order-pricing';
import { fromCents, toCents } from './money';
import { seniorPwdAmountDue, seniorPwdAmounts, seniorPwdReduction, sumSeniorPwdAmounts } from './senior-pwd';

// Round half up of numerator / denominator with whole numbers (BigInt), so the oracle shares no code with the app.
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function oracle(coveredCents: number, vatRegistered: boolean): { vatExempt: number; discount: number } {
  const covered = BigInt(coveredCents);
  if (!vatRegistered) {
    return { vatExempt: 0, discount: Number(roundDiv(covered, 5n)) };
  }

  const net = roundDiv(covered * 100n, 112n);
  return { vatExempt: Number(covered - net), discount: Number(roundDiv(net, 5n)) };
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('senior / PWD discount (properties)', () => {
  it('matches an independent integer oracle for every cent up to ten thousand pesos', () => {
    const mismatches: string[] = [];
    for (let cents = 1; cents <= 1_000_000; cents++) {
      for (const vat of [false, true]) {
        const amounts = seniorPwdAmounts(fromCents(cents), vat);
        const expected = oracle(cents, vat);
        if (toCents(amounts.vatExempt) !== expected.vatExempt || toCents(amounts.discount) !== expected.discount) {
          mismatches.push(`${cents} cents, vat ${vat}`);
        }
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('rows, persons and the order total add up for random orders', () => {
    const random = seededRandom(20261113);
    const next = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

    for (let round = 0; round < 500; round++) {
      const vat = next(0, 1) === 0;
      const lines: PricedLine[] = [];
      const rows = [] as ReturnType<typeof seniorPwdAmounts>[];
      const lineCount = next(1, 6);
      for (let i = 0; i < lineCount; i++) {
        const addOnCount = next(0, 2);
        const line: PricedLine = {
          qty: next(1, 9),
          price: fromCents(next(1, 50_000)),
          addOns: Array.from({ length: addOnCount }, () => ({ price: fromCents(next(0, 5_000)), quantity: next(1, 3) })),
        };
        lines.push(line);
        if (next(0, 1) === 1) {
          rows.push(seniorPwdAmounts(lineTotal(line), vat));
        }
      }

      const list = lines.reduce((sum, line) => sum + toCents(lineTotal(line)), 0);
      const reduction = rows.reduce((sum, row) => sum + toCents(seniorPwdReduction(row)), 0);
      const summed = sumSeniorPwdAmounts(rows);

      expect(toCents(summed.vatExempt) + toCents(summed.discount), `round ${round}`).toBe(reduction);
      expect(list - reduction).toBeGreaterThanOrEqual(0);
      for (const row of rows) {
        expect(toCents(row.covered) - toCents(row.vatExempt) - toCents(row.discount)).toBe(toCents(seniorPwdAmountDue(row)));
      }
    }
  });
});
