import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { invoiceDifference, packUnitCost, receiptLineTotal, unitsFromPacks } from './receiving';

interface ReceiptLineCase {
  name: string;
  packs: number;
  unitsPerPack: number;
  packPrice: number | null;
  expectedQuantity: number;
  expectedUnitCost: number | null;
  expectedLineTotal: number | null;
}

interface InvoiceDifferenceCase {
  name: string;
  invoiceTotal: number | null;
  lineTotals: (number | null)[];
  expected: number | null;
}

describe('receiving: the cases shared with the API', () => {
  it.each((cases.receiptLine as ReceiptLineCase[]).map((c) => [c.name, c] as const))(
    'receipt line: %s',
    (_name, c) => {
      expect(unitsFromPacks(c.packs, c.unitsPerPack)).toBe(c.expectedQuantity);
      expect(packUnitCost(c.packPrice, c.unitsPerPack)).toBe(c.expectedUnitCost);
      expect(receiptLineTotal(c.packs, c.packPrice)).toBe(c.expectedLineTotal);
    },
  );

  it.each((cases.invoiceDifference as InvoiceDifferenceCase[]).map((c) => [c.name, c] as const))(
    'invoice difference: %s',
    (_name, c) => {
      expect(invoiceDifference(c.invoiceTotal, c.lineTotals)).toBe(c.expected);
    },
  );

  it('has no unit cost for an empty pack', () => {
    expect(packUnitCost(100, 0)).toBeNull();
  });
});
