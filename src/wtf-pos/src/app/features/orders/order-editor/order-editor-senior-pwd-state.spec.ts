import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CartItemDto } from '@shared/models';
import { describe, expect, it } from 'vitest';
import { OrderEditorSeniorPwd } from './order-editor-senior-pwd-state';

const person = { type: 1, idNumber: 'SC-1', customerName: 'Rosa Reyes' };

function line(qty: number): CartItemDto {
  return { productId: 'p1', name: 'Latte', price: 100, qty, addOns: [] } as unknown as CartItemDto;
}

describe('OrderEditorSeniorPwd', () => {
  function create(options: { canApply?: boolean; busy?: boolean; vat?: boolean; blocked?: string | null } = {}) {
    const cart = signal<CartItemDto[]>([line(3)]);
    const state = TestBed.runInInjectionContext(
      () =>
        new OrderEditorSeniorPwd({
          cart,
          vatRegistered: signal(options.vat ?? false),
          canApply: () => options.canApply ?? true,
          isBusy: () => options.busy ?? false,
          blockedReasonOf: () => options.blocked ?? null,
        }),
    );
    return { cart, state };
  }

  it('opens only when allowed and not busy', () => {
    const blocked = create({ canApply: false });
    blocked.state.open();
    expect(blocked.state.showDialog()).toBe(false);

    const busy = create({ busy: true });
    busy.state.open();
    expect(busy.state.showDialog()).toBe(false);

    const ok = create();
    ok.state.open();
    expect(ok.state.showDialog()).toBe(true);
    ok.state.close();
    expect(ok.state.showDialog()).toBe(false);
  });

  it('splits the covered quantity, tracks the person and reports the reduction', () => {
    const { cart, state } = create();

    state.apply([{ person, picks: { 0: 1 } } as never]);

    expect(cart().map((c) => [c.qty, c.seniorPwdPersonIndex ?? null])).toEqual([
      [1, 0],
      [2, null],
    ]);
    expect(state.persons()).toEqual([person]);
    expect(state.isCoveredByPerson(cart()[0])).toBe(true);
    expect(state.isCoveredByPerson(cart()[1])).toBe(false);
    expect(state.lineReduction(0)).toBe(20);
    expect(state.lineReduction(1)).toBe(0);
    expect(state.totals()[0].discount).toBe(20);
    expect(state.commandPart()).toEqual({ seniorPwdPersons: [person] });
  });

  it('removing puts the lines back together and closes the dialog', () => {
    const { cart, state } = create();
    state.apply([{ person, picks: { 0: 1 } } as never]);
    state.open();

    state.remove();

    expect(cart().map((c) => c.qty)).toEqual([3]);
    expect(state.persons()).toEqual([]);
    expect(state.showDialog()).toBe(false);
    expect(state.hasAnything()).toBe(false);
    expect(state.commandPart()).toEqual({});
  });

  it('flags a covered line that became ineligible', () => {
    const { state } = create({ blocked: 'Promotion item, not eligible' });
    state.apply([{ person, picks: { 0: 1 } } as never]);

    expect(state.conflict()).toBe(true);
  });

  it('drops a person whose covered lines are gone', () => {
    const { cart, state } = create();
    state.apply([{ person, picks: { 0: 1 } } as never]);
    TestBed.tick();

    cart.set([]);
    TestBed.tick();

    expect(state.persons()).toEqual([]);
  });
});
