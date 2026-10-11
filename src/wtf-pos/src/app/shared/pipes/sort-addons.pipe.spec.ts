import { AddOnTypeEnum, CartAddOnDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { SortAddOnsPipe } from './sort-addons.pipe';

const addOn = (name: string, addOnType?: AddOnTypeEnum): CartAddOnDto => ({
  addOnId: name,
  name,
  price: 0,
  addOnType,
});

describe('SortAddOnsPipe', () => {
  const pipe = new SortAddOnsPipe();

  it.each([null, undefined, []])('returns an empty array for %j', (input) => {
    expect(pipe.transform(input as CartAddOnDto[] | null | undefined)).toEqual([]);
  });

  it('orders by type: Size, Flavor, Sauce, Topping, Extra', () => {
    const result = pipe.transform([
      addOn('e', AddOnTypeEnum.Extra),
      addOn('t', AddOnTypeEnum.Topping),
      addOn('s', AddOnTypeEnum.Sauce),
      addOn('f', AddOnTypeEnum.Flavor),
      addOn('z', AddOnTypeEnum.Size),
    ]);

    expect(result.map((a) => a.name)).toEqual(['z', 'f', 's', 't', 'e']);
  });

  it('sorts by name within the same type', () => {
    const result = pipe.transform([
      addOn('Whip', AddOnTypeEnum.Topping),
      addOn('Choco', AddOnTypeEnum.Topping),
    ]);

    expect(result.map((a) => a.name)).toEqual(['Choco', 'Whip']);
  });

  it('puts untyped add-ons last', () => {
    const result = pipe.transform([addOn('a'), addOn('b', AddOnTypeEnum.Extra)]);

    expect(result.map((a) => a.name)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [addOn('b', AddOnTypeEnum.Extra), addOn('a', AddOnTypeEnum.Size)];
    const snapshot = [...input];

    pipe.transform(input);

    expect(input).toEqual(snapshot);
  });
});
