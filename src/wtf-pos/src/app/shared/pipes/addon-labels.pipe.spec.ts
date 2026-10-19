import { AddOnTypeEnum, CartAddOnDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { AddOnLabelsPipe } from './addon-labels.pipe';

const addOn = (id: string, name: string, type?: AddOnTypeEnum): CartAddOnDto => ({
  addOnId: id,
  name,
  price: 0,
  addOnType: type,
});

describe('AddOnLabelsPipe', () => {
  const pipe = new AddOnLabelsPipe();

  it.each([null, undefined, []])('returns an empty array for %j', (input) => {
    expect(pipe.transform(input as CartAddOnDto[] | null | undefined)).toEqual([]);
  });

  it('counts repeats and orders by type then name', () => {
    expect(
      pipe.transform([
        addOn('t', 'Boba', AddOnTypeEnum.Topping),
        addOn('z', 'Small', AddOnTypeEnum.Size),
        addOn('t', 'Boba', AddOnTypeEnum.Topping),
      ]),
    ).toEqual(['Small', '2x Boba']);
  });
});
