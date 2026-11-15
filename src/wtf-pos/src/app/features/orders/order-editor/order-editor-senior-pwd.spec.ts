import { describe, expect, it } from 'vitest';
import { CartItemDto, SeniorPwdTypeEnum } from '@shared/models';
import {
  applySelections,
  coveredQuantityOf,
  dropUnusedPersons,
  seniorPwdBlockedReasonOf,
  seniorPwdCommandPart,
  lineSignature,
  selectionsFromCart,
  SeniorPwdSelection,
  uncoverLines,
} from './order-editor-senior-pwd';

const line = (over: Partial<CartItemDto> = {}): CartItemDto => ({
  productId: 'latte',
  name: 'Latte',
  price: 120,
  qty: 3,
  ...over,
});

const rosa = { type: SeniorPwdTypeEnum.Senior, idNumber: 'SC-1', customerName: 'Rosa' };
const jun = { type: SeniorPwdTypeEnum.Pwd, idNumber: 'PWD-2', customerName: 'Jun' };

describe('senior / PWD cart helpers', () => {
  it('splits a line into the covered part and the rest', () => {
    const { cart, persons } = applySelections([line()], [{ person: rosa, picks: { 0: 1 } }]);

    expect(cart.map((c) => [c.qty, c.seniorPwdPersonIndex ?? null])).toEqual([
      [1, 0],
      [2, null],
    ]);
    expect(persons).toEqual([rosa]);
  });

  it('covers a whole line without leaving a zero line behind', () => {
    const { cart } = applySelections([line({ qty: 2 })], [{ person: rosa, picks: { 0: 2 } }]);

    expect(cart.map((c) => [c.qty, c.seniorPwdPersonIndex])).toEqual([[2, 0]]);
  });

  it('splits one line between two people and drops a person who covers nothing', () => {
    const selections: SeniorPwdSelection[] = [
      { person: rosa, picks: { 0: 1 } },
      { person: { ...jun }, picks: { 0: 0 } },
      { person: { ...jun, idNumber: 'PWD-3' }, picks: { 0: 1 } },
    ];

    const { cart, persons } = applySelections([line()], selections);

    expect(persons.map((p) => p.idNumber)).toEqual(['SC-1', 'PWD-3']);
    expect(cart.map((c) => [c.qty, c.seniorPwdPersonIndex ?? null])).toEqual([
      [1, 0],
      [1, 1],
      [1, null],
    ]);
  });

  it('never covers more than the line holds', () => {
    const { cart } = applySelections([line({ qty: 2 })], [{ person: rosa, picks: { 0: 5 } }]);

    expect(cart.map((c) => c.qty)).toEqual([2]);
  });

  it('puts covered lines back into the line they were split from', () => {
    const { cart } = applySelections([line()], [{ person: rosa, picks: { 0: 1 } }]);

    const lines = uncoverLines(cart);

    expect(lines.map((c) => [c.qty, c.seniorPwdPersonIndex ?? null])).toEqual([[3, null]]);
  });

  it('rebuilds what each person covers from the cart', () => {
    const { cart, persons } = applySelections(
      [line(), line({ productId: 'mocha', name: 'Mocha', price: 100, qty: 1 })],
      [{ person: rosa, picks: { 0: 2, 1: 1 } }],
    );

    const { lines, selections } = selectionsFromCart(cart, persons);

    expect(lines.map((c) => c.qty)).toEqual([3, 1]);
    expect(selections[0].picks).toEqual({ 0: 2, 1: 1 });
  });

  it('tells lines with other add-ons apart', () => {
    const plain = line();
    const withShot = line({ addOns: [{ addOnId: 'shot', name: 'Shot', price: 20 }] });

    expect(lineSignature(plain)).not.toBe(lineSignature(withShot));
  });

  it('adds up what other people already cover of a line', () => {
    const selections: SeniorPwdSelection[] = [
      { person: rosa, picks: { 0: 2 } },
      { person: jun, picks: { 0: 1 } },
    ];

    expect(coveredQuantityOf(selections, 0)).toBe(3);
    expect(coveredQuantityOf(selections, 0, 1)).toBe(2);
  });

  it('drops a person nobody is covered by and renumbers the rest', () => {
    const cart = [line({ seniorPwdPersonIndex: 1 }), line({ seniorPwdPersonIndex: null })];

    const pruned = dropUnusedPersons(cart, [rosa, jun]);

    expect(pruned?.persons).toEqual([jun]);
    expect(pruned?.cart.map((c) => c.seniorPwdPersonIndex ?? null)).toEqual([0, null]);
    expect(dropUnusedPersons([line({ seniorPwdPersonIndex: 0 })], [rosa])).toBeNull();
  });

  it('says why a line cannot be covered', () => {
    expect(seniorPwdBlockedReasonOf(true, false, false)).toBeNull();
    expect(seniorPwdBlockedReasonOf(true, true, false)).toBe('Promotion item, not eligible');
    expect(seniorPwdBlockedReasonOf(false, false, false)).toBe('Not eligible');
  });

  it('adds the persons to a command only when there are some', () => {
    expect(seniorPwdCommandPart([])).toEqual({});
    expect(seniorPwdCommandPart([rosa])).toEqual({ seniorPwdPersons: [rosa] });
  });
});
