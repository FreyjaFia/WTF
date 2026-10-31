import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { StockCartLine, stockShortfalls } from './stock-limits';

interface ShortfallCase {
  name: string;
  balances: { itemId: string; balance: number }[];
  links: { productId: string; itemId: string; perSale: number; replacesItemId?: string }[];
  sizeAmounts?: { productId: string; sizeProductId: string; itemId: string; quantity: number }[];
  lines: { productId: string; quantity: number; addOns: { productId: string; quantity: number }[] }[];
  expected: { itemId: string; needed: number; balance: number; short: number }[];
}

describe('stock shortfalls: the cases shared with the API', () => {
  it.each((cases.stockShortfalls as ShortfallCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = stockShortfalls(
      c.lines.map((line, index) => ({ ...line, key: String(index) })),
      c.links.map((link) => ({
        productId: link.productId,
        itemId: link.itemId,
        quantityPerSale: link.perSale,
        replacesItemId: link.replacesItemId,
      })),
      c.balances.map((b) => ({ id: b.itemId, balance: b.balance })),
      c.sizeAmounts ?? [],
    );

    expect(result.map(({ itemId, needed, balance, short }) => ({ itemId, needed, balance, short }))).toEqual(
      c.expected,
    );
  });
});

describe('stock shortfalls: which cart lines are involved', () => {
  const links = [
    { productId: 'mocha', itemId: 'cup', quantityPerSale: 1 },
    { productId: 'latte', itemId: 'cup', quantityPerSale: 1 },
    { productId: 'croissant', itemId: 'bag', quantityPerSale: 1 },
  ];
  const lines: StockCartLine[] = [
    { key: 'a', productId: 'mocha', quantity: 2 },
    { key: 'b', productId: 'croissant', quantity: 1 },
    { key: 'c', productId: 'latte', quantity: 1 },
  ];

  it('names the lines that use the short item and leaves the others out', () => {
    const [result] = stockShortfalls(lines, links, [
      { id: 'cup', balance: 2 },
      { id: 'bag', balance: 10 },
    ]);

    expect(result.itemId).toBe('cup');
    expect(result.short).toBe(1);
    expect(result.lineKeys.sort()).toEqual(['a', 'c']);
  });

  it('reports nothing for an empty cart or when no item blocks', () => {
    expect(stockShortfalls([], links, [{ id: 'cup', balance: 0 }])).toEqual([]);
    expect(stockShortfalls(lines, links, [])).toEqual([]);
  });

  it('counts an add-on once per unit of the line it is on', () => {
    const [result] = stockShortfalls(
      [{ key: 'x', productId: 'latte', quantity: 3, addOns: [{ productId: 'mocha', quantity: 1 }] }],
      links,
      [{ id: 'cup', balance: 5 }],
    );

    expect(result.needed).toBe(6);
    expect(result.short).toBe(1);
  });
});

describe('stock shortfalls: replacement', () => {
  it('skips the drink link for a replaced item but names no line for it', () => {
    const links = [
      { productId: 'latte', itemId: 'milk', quantityPerSale: 200 },
      { productId: 'oatmilk', itemId: 'oat', quantityPerSale: 150, replacesItemId: 'milk' },
    ];
    const lines: StockCartLine[] = [
      { key: 'a', productId: 'latte', quantity: 1, addOns: [{ productId: 'oatmilk', quantity: 1 }] },
      { key: 'b', productId: 'latte', quantity: 1 },
    ];

    const result = stockShortfalls(lines, links, [
      { id: 'milk', balance: 100 },
      { id: 'oat', balance: 1000 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe('milk');
    expect(result[0].needed).toBe(200);
    expect(result[0].lineKeys).toEqual(['b']);
  });

  it('builds the replaced set from links to items that do not block', () => {
    const links = [
      { productId: 'latte', itemId: 'milk', quantityPerSale: 200 },
      { productId: 'oatmilk', itemId: 'other', quantityPerSale: 1, replacesItemId: 'milk' },
    ];
    const lines: StockCartLine[] = [
      { key: 'a', productId: 'latte', quantity: 1, addOns: [{ productId: 'oatmilk', quantity: 1 }] },
    ];

    expect(stockShortfalls(lines, links, [{ id: 'milk', balance: 0 }])).toEqual([]);
  });
});
