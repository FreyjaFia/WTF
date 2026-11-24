import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  KitchenAccessError,
  KitchenService,
  SignalRService,
} from '@core/services';
import { KitchenOrderDto, KitchenStateEnum, OrderSourceEnum } from '@shared/models';
import { KitchenBoardComponent } from './kitchen-board';

function order(number: number, state: KitchenStateEnum, extra: Partial<KitchenOrderDto> = {}): KitchenOrderDto {
  return {
    id: `id-${number}`,
    orderNumber: number,
    createdAt: new Date(Date.now() - 2 * 60000).toISOString(),
    kitchenStatus: state,
    source: OrderSourceEnum.Pos,
    lines: [{ name: 'Iced Latte', quantity: 2, addOns: [{ name: 'Iced', quantity: 1, isTemperature: true }] }],
    isStale: false,
    isStopMaking: false,
    ...extra,
  };
}

describe('KitchenBoardComponent', () => {
  const changed$ = new Subject<string>();
  let kitchen: { getBoard: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; markChangeSeen: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn>; clearOld: ReturnType<typeof vi.fn> };
  let alerts: { error: ReturnType<typeof vi.fn> };

  function setup(orders: KitchenOrderDto[], canUpdate = true, boardError: Error | null = null) {
    kitchen = {
      getBoard: vi.fn(() =>
        boardError ? throwError(() => boardError) : of({ orders, serverTime: new Date().toISOString() }),
      ),
      move: vi.fn((id: string, request: { to: KitchenStateEnum }) =>
        of({ ...orders.find((o) => o.id === id)!, kitchenStatus: request.to }),
      ),
      markChangeSeen: vi.fn((id: string) => of({ ...orders.find((o) => o.id === id)!, changeKind: 0, changeNote: null })),
      dismiss: vi.fn((id: string) => of(orders.find((o) => o.id === id)!)),
      clearOld: vi.fn(() => of({ cleared: 1 })),
    };
    alerts = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: KitchenService, useValue: kitchen },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canUpdateKitchen: () => canUpdate } },
        {
          provide: SignalRService,
          useValue: { startStaffOrdersHub: vi.fn(), stopStaffOrdersHub: vi.fn(), orderChanged: changed$.asObservable() },
        },
        { provide: ConnectivityService, useValue: { isOnline: signal(true), checkNow: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(KitchenBoardComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, c: fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown> };
  }

  it('puts each order in the column of its kitchen state', () => {
    const { el } = setup([order(1, KitchenStateEnum.New), order(2, KitchenStateEnum.Preparing), order(3, KitchenStateEnum.Ready)]);
    expect(el.querySelector('[data-testid="kitchen-column-new"] [data-testid="kitchen-card-1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="kitchen-column-preparing"] [data-testid="kitchen-card-2"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="kitchen-column-ready"] [data-testid="kitchen-card-3"]')).not.toBeNull();
  });

  it('shows the temperature chip and no prices', () => {
    const { el } = setup([order(1, KitchenStateEnum.New)]);
    expect(el.querySelector('[data-testid="kitchen-temperature"]')?.textContent).toContain('Iced');
    expect(el.textContent).not.toContain('₱');
  });

  it('turns the age amber at 5 minutes and red at 10', () => {
    const old = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
    const { el } = setup([
      order(1, KitchenStateEnum.New, { createdAt: old(4) }),
      order(2, KitchenStateEnum.New, { createdAt: old(6) }),
      order(3, KitchenStateEnum.New, { createdAt: old(12) }),
    ]);
    const tone = (n: number) => el.querySelector(`[data-testid="kitchen-card-${n}"]`)?.getAttribute('data-age-tone');
    expect(tone(1)).toBe('ok');
    expect(tone(2)).toBe('amber');
    expect(tone(3)).toBe('red');
  });

  it('moves an order forward with the state it was shown in', () => {
    const { el } = setup([order(1, KitchenStateEnum.New)]);
    (el.querySelector('[data-testid="kitchen-card-1"] [data-testid="kitchen-advance"]') as HTMLButtonElement).click();
    expect(kitchen.move).toHaveBeenCalledWith('id-1', { to: KitchenStateEnum.Preparing, from: KitchenStateEnum.New });
  });

  it('steps one state back and offers no undo on a new order', () => {
    const { el } = setup([order(1, KitchenStateEnum.Ready), order(2, KitchenStateEnum.New)]);
    expect(el.querySelector('[data-testid="kitchen-card-2"] [data-testid="kitchen-undo"]')).toBeNull();
    (el.querySelector('[data-testid="kitchen-card-1"] [data-testid="kitchen-undo"]') as HTMLButtonElement).click();
    expect(kitchen.move).toHaveBeenCalledWith('id-1', { to: KitchenStateEnum.Preparing, from: KitchenStateEnum.Ready });
  });

  it('hides the buttons from someone who cannot update the kitchen', () => {
    const { el } = setup([order(1, KitchenStateEnum.New)], false);
    expect(el.querySelector('[data-testid="kitchen-advance"]')).toBeNull();
  });

  it('shows a stop-making card that can be dismissed, and a From yesterday strip', () => {
    const { el, fixture } = setup([
      order(1, KitchenStateEnum.Preparing, { isStopMaking: true }),
      order(2, KitchenStateEnum.New, { isStale: true }),
    ]);
    expect(el.querySelector('[data-testid="kitchen-stop-1"]')?.textContent).toContain('Stop making');
    expect(el.querySelector('[data-testid="kitchen-stale"]')?.textContent).toContain('From yesterday');
    (el.querySelector('[data-testid="kitchen-dismiss"]') as HTMLButtonElement).click();
    expect(kitchen.dismiss).toHaveBeenCalledWith('id-1');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="kitchen-stop-1"]')).toBeNull();
  });

  it('refetches when the hub reports a change', async () => {
    vi.useFakeTimers();
    setup([order(1, KitchenStateEnum.New)]);
    const before = kitchen.getBoard.mock.calls.length;
    changed$.next('id-1');
    await vi.advanceTimersByTimeAsync(400);
    expect(kitchen.getBoard.mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('shows a notice when loading fails and tells the cook when a move fails', () => {
    const { el } = setup([order(1, KitchenStateEnum.New)]);
    kitchen.move.mockReturnValueOnce(throwError(() => new Error('Not allowed')));
    (el.querySelector('[data-testid="kitchen-advance"]') as HTMLButtonElement).click();
    expect(alerts.error).toHaveBeenCalledWith('Not allowed');
  });

  it('says the person has no access to this branch\'s kitchen, instead of a connection problem', () => {
    const { el } = setup([], true, new KitchenAccessError('You cannot use that branch.'));

    expect(el.querySelector('[data-testid="kitchen-no-access"]')?.textContent).toContain('You cannot use that branch.');
    expect(el.querySelector('[data-testid="kitchen-load-failed"]')).toBeNull();
  });

  it('still shows the retry notice for a failure that is not about access', () => {
    const { el } = setup([], true, new Error('Unable to load the kitchen orders.'));

    expect(el.querySelector('[data-testid="kitchen-load-failed"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="kitchen-no-access"]')).toBeNull();
  });

  it('does not ring the chime for orders that only appear because the filter changed', () => {
    const { c } = setup([order(1, KitchenStateEnum.New)]);
    const chime = vi.fn();
    (c as unknown as { playChime: () => void }).playChime = chime;
    (c as unknown as { chimeOn: { set: (on: boolean) => void } }).chimeOn.set(true);
    kitchen.getBoard.mockReturnValue(
      of({ orders: [order(1, KitchenStateEnum.New), order(2, KitchenStateEnum.New)], serverTime: new Date().toISOString() }),
    );

    c['setSource'](OrderSourceEnum.Pos);

    expect(chime).not.toHaveBeenCalled();

    kitchen.getBoard.mockReturnValue(
      of({ orders: [order(1, KitchenStateEnum.New), order(2, KitchenStateEnum.New), order(3, KitchenStateEnum.New)], serverTime: new Date().toISOString() }),
    );
    c['refresh']();

    expect(chime).toHaveBeenCalledTimes(1);
  });
});
