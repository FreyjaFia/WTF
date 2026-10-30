import { describe, expect, it } from 'vitest';
import cases from './calculation-cases.json';
import { StockCartLine, stockShortfalls } from './stock-limits';

interface ShortfallCase {
  name: string;
  balances: { itemId: string; balance: number }[];
  links: { productId: string; itemId: string; perSale: number; scalesWithSize?: boolean; replacesItemId?: string }[];
  multipliers?: { productId: string; multiplier: number }[];
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
        scalesWithSize: link.scalesWithSize,
        replacesItemId: link.replacesItemId,
      })),
      c.balances.map((b) => ({ id: b.itemId, balance: b.balance })),
      c.multipliers ?? [],
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

describe('stock shortfalls: size scaling and replacement', () => {
  const balances = [
    { id: 'milk', balance: 100 },
    { id: 'oat', balance: 100 },
  ];
  const multipliers = [{ productId: 'large', multiplier: 1.5 }];

  it('scales only the links marked scales with size', () => {
    const links = [
      { productId: 'latte', itemId: 'milk', quantityPerSale: 100, scalesWithSize: true },
      { productId: 'latte', itemId: 'oat', quantityPerSale: 10 },
    ];
    const lines: StockCartLine[] = [{ key: 'a', productId: 'latte', quantity: 1, addOns: [{ productId: 'large', quantity: 1 }] }];

    const result = stockShortfalls(lines, links, [{ id: 'milk', balance: 100 }, { id: 'oat', balance: 5 }], multipliers);

    expect(result.map((r) => [r.itemId, r.needed])).toEqual([
      ['milk', 150],
      ['oat', 10],
    ]);
  });

  it('scales the links of another add-on on the same line', () => {
    const links = [{ productId: 'shot', itemId: 'milk', quantityPerSale: 40, scalesWithSize: true }];
    const lines: StockCartLine[] = [
      {
        key: 'a',
        productId: 'latte',
        quantity: 2,
        addOns: [{ productId: 'large', quantity: 1 }, { productId: 'shot', quantity: 1 }],
      },
    ];

    const [result] = stockShortfalls(lines, links, balances, multipliers);

    expect(result.needed).toBe(120);
    expect(result.short).toBe(20);
  });

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
