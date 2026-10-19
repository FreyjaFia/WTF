import { describe, expect, it } from 'vitest';
import { buildDeals, dealAddOnsTotal, DealAddOn, DealProduct, DealSource } from './deals';

const LATTE: DealProduct = { id: 'latte', name: 'Latte', price: 150, imageUrl: 'latte.png' };
const MOCHA: DealProduct = { id: 'mocha', name: 'Mocha', price: 160 };
const ADD_ONS: Record<string, DealAddOn> = {
  'latte|small': { id: 'small', name: 'Small', price: 0 },
  'latte|large': { id: 'large', name: 'Large', price: 30 },
  'latte|oat': { id: 'oat', name: 'Oat Milk', price: 20 },
};

const find = (id: string) => [LATTE, MOCHA].find((p) => p.id === id);
const findAddOn = (productId: string, addOnId: string) => ADD_ONS[`${productId}|${addOnId}`];
const build = (sources: DealSource[]) => buildDeals(sources, find, findAddOn);

describe('buildDeals', () => {
  it('prices the product with exactly the add-ons the rule needs', () => {
    const [deal] = build([
      { productId: 'latte', fixedPrice: 40, addOns: [{ addOnProductId: 'large', quantity: 1 }] },
    ]);

    expect(deal.title).toBe('Latte + Large');
    expect(deal.listPrice).toBe(180);
    expect(deal.price).toBe(140);
    expect(deal.label).toBe('Promo -₱40.00');
    expect(deal.imageUrl).toBe('latte.png');
    expect(deal.limited).toBe(false);
  });

  it('shows a plain-product rule as the product alone', () => {
    const [deal] = build([{ productId: 'mocha', percentOff: 25, addOns: [] }]);

    expect(deal.title).toBe('Mocha');
    expect(deal.listPrice).toBe(160);
    expect(deal.price).toBe(120);
    expect(deal.label).toBe('Promo -25%');
    expect(deal.imageUrl).toBeNull();
  });

  it('names an add-on taken more than once', () => {
    const [deal] = build([
      { productId: 'latte', percentOff: 10, addOns: [{ addOnProductId: 'oat', quantity: 2 }] },
    ]);

    expect(deal.title).toBe('Latte + 2 Oat Milk');
    expect(deal.listPrice).toBe(190);
    expect(deal.price).toBe(175);
  });

  it('an amount off that covers the price shows the price taken off while add-ons are still charged', () => {
    const [deal] = build([
      { productId: 'latte', fixedPrice: 500, addOns: [{ addOnProductId: 'large', quantity: 1 }] },
    ]);

    expect(deal.label).toBe('Promo -₱150.00');
    expect(deal.price).toBe(30);
    expect(deal.listPrice).toBe(180);
  });

  it('an amount off that covers the price reads Free when the add-ons cost nothing', () => {
    const [deal] = build([
      { productId: 'latte', fixedPrice: 500, addOns: [{ addOnProductId: 'small', quantity: 1 }] },
    ]);

    expect(deal.label).toBe('Free');
    expect(deal.price).toBe(0);
  });

  it('a plain-product rule that covers the price reads Free', () => {
    const [deal] = build([{ productId: 'mocha', fixedPrice: 160, addOns: [] }]);

    expect(deal.label).toBe('Free');
    expect(deal.price).toBe(0);
  });

  it('marks a promotion with a usage limit', () => {
    const [deal] = build([{ productId: 'mocha', percentOff: 10, addOns: [], remaining: 3 }]);

    expect(deal.limited).toBe(true);
  });

  it.each([0, -1])('leaves out a rule with %s uses left', (remaining) => {
    expect(build([{ productId: 'mocha', percentOff: 10, addOns: [], remaining }])).toEqual([]);
  });

  it('leaves out a rule whose product or add-on is missing from the menu', () => {
    expect(build([{ productId: 'ghost', percentOff: 10, addOns: [] }])).toEqual([]);
    expect(
      build([{ productId: 'latte', percentOff: 10, addOns: [{ addOnProductId: 'gone', quantity: 1 }] }]),
    ).toEqual([]);
  });

  it('leaves out a rule that takes nothing off', () => {
    expect(build([{ productId: 'mocha', addOns: [] }])).toEqual([]);
    expect(build([{ productId: 'mocha', fixedPrice: 0, percentOff: 0, addOns: [] }])).toEqual([]);
  });

  it('keeps only the cheapest card for the same product and add-ons, in any add-on order', () => {
    const deals = build([
      {
        productId: 'latte',
        percentOff: 10,
        addOns: [
          { addOnProductId: 'small', quantity: 1 },
          { addOnProductId: 'oat', quantity: 1 },
        ],
      },
      {
        productId: 'latte',
        percentOff: 30,
        addOns: [
          { addOnProductId: 'oat', quantity: 1 },
          { addOnProductId: 'small', quantity: 1 },
        ],
      },
    ]);

    expect(deals).toHaveLength(1);
    expect(deals[0].price).toBe(125);
  });

  it('sorts the cards by title', () => {
    const titles = build([
      { productId: 'mocha', percentOff: 10, addOns: [] },
      { productId: 'latte', percentOff: 10, addOns: [] },
    ]).map((d) => d.title);

    expect(titles).toEqual(['Latte', 'Mocha']);
  });

  it('sums the add-ons of a deal', () => {
    const [deal] = build([
      { productId: 'latte', percentOff: 10, addOns: [{ addOnProductId: 'oat', quantity: 2 }] },
    ]);

    expect(dealAddOnsTotal(deal)).toBe(40);
  });
});
