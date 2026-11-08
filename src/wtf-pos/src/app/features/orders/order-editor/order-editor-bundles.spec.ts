import type { AddOnGroupDto, ProductDto } from '@shared/models';
import { PromotionTypeEnum, SYSTEM_CATALOG_IDS } from '@shared/models';
import { describe, expect, it } from 'vitest';
import {
  type BundlePromotionSelection,
  bundleCartItems,
  mixMatchOptionGroups,
  mixMatchSelectionFromAddonSelection,
  preselectedMixMatchOptions,
} from './order-editor-bundles';

const product = (id: string, name: string, price: number): ProductDto =>
  ({ id, name, price, imageUrl: null }) as ProductDto;

const products = [
  product('b', 'Mocha', 120),
  product('a', 'Latte', 100),
  product('c', 'Syrup', 20),
];

const bundle = (items: BundlePromotionSelection['items']): BundlePromotionSelection => ({
  id: 'bundle-1',
  name: 'Combo',
  typeId: PromotionTypeEnum.MixMatch,
  isActive: true,
  bundlePrice: 200,
  items,
});

describe('mixMatchOptionGroups', () => {
  it('lists the bundle products at price 0, sorted by name, skipping unknown ones', () => {
    const groups = mixMatchOptionGroups(
      bundle([
        { productId: 'b', addOns: [] },
        { productId: 'a', addOns: [] },
        { productId: 'missing', addOns: [] },
      ]),
      products,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe(SYSTEM_CATALOG_IDS.extraAddOnType);
    expect(groups[0].displayName).toBe('Items');
    expect(groups[0].options.map((o) => [o.name, o.price, o.overridePrice])).toEqual([
      ['Latte', 0, 0],
      ['Mocha', 0, 0],
    ]);
  });
});

describe('preselectedMixMatchOptions', () => {
  it('repeats each item by its quantity at price 0 and skips zero quantities', () => {
    const result = preselectedMixMatchOptions(
      bundle([
        { productId: 'a', addOns: [], quantity: 2 },
        { productId: 'b', addOns: [], quantity: 0 },
        { productId: 'zzz', addOns: [], quantity: 1 },
      ]),
      products,
    );

    expect(result.map((x) => [x.addOnId, x.name, x.price])).toEqual([
      ['a', 'Latte', 0],
      ['a', 'Latte', 0],
      ['zzz', 'Selected item', 0],
    ]);
    expect(result.every((x) => x.addOnType === SYSTEM_CATALOG_IDS.extraAddOnType)).toBe(true);
  });
});

describe('mixMatchSelectionFromAddonSelection', () => {
  it('sets quantities from the selection and drops unselected items', () => {
    const result = mixMatchSelectionFromAddonSelection(
      bundle([
        { productId: 'a', addOns: [], quantity: 5 },
        { productId: 'b', addOns: [], quantity: 5 },
      ]),
      [
        { addOnId: 'a', name: 'Latte', price: 0, addOnType: 1 },
        { addOnId: 'a', name: 'Latte', price: 0, addOnType: 1 },
      ],
    );

    expect(result.items).toEqual([{ productId: 'a', addOns: [], quantity: 2 }]);
  });
});

describe('bundleCartItems', () => {
  const groups: AddOnGroupDto[] = [
    {
      type: 4,
      displayName: 'Extra',
      options: [{ ...product('c', 'Syrup', 20), overridePrice: 15 } as never],
    },
  ];
  const lookup = (id: string): AddOnGroupDto[] => (id === 'a' ? groups : []);

  it('builds sorted lines, expands add-ons with override prices and ignores unknown products', () => {
    const result = bundleCartItems(
      bundle([
        { productId: 'b', addOns: [], quantity: 0 },
        { productId: 'a', addOns: [{ addOnProductId: 'c', quantity: 2 }], quantity: 3 },
        { productId: 'missing', addOns: [] },
      ]),
      products,
      lookup,
    );

    expect(result.map((x) => [x.name, x.qty])).toEqual([
      ['Latte', 3],
      ['Mocha', 1],
    ]);
    expect(result[0].addOns).toEqual([
      { addOnId: 'c', name: 'Syrup', price: 15, addOnType: 4 },
      { addOnId: 'c', name: 'Syrup', price: 15, addOnType: 4 },
    ]);
    expect(result[1].addOns).toBeUndefined();
  });

  it('falls back to the product name and price when the add-on is not offered', () => {
    const result = bundleCartItems(
      bundle([{ productId: 'b', addOns: [{ addOnProductId: 'c', quantity: 1 }] }]),
      products,
      lookup,
    );

    expect(result[0].addOns).toEqual([
      { addOnId: 'c', name: 'Syrup', price: 20, addOnType: undefined },
    ]);
  });
});
