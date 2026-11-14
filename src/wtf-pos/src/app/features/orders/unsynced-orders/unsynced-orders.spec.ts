import { TestBed } from '@angular/core/testing';
import { AlertService, ListStateService, UnsyncedOrderService, UserService } from '@core/services';
import {
  PaymentMethodEnum,
  UnsyncedOrderDetailDto,
  UnsyncedOrderDto,
  UnsyncedOrderResolutionEnum,
  UnsyncedOrderStatusEnum,
} from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { internals } from '../../../testing/feature-spec-helpers';
import { UnsyncedOrders } from './unsynced-orders';

function makeOrder(overrides: Partial<UnsyncedOrderDto> = {}): UnsyncedOrderDto {
  return {
    id: 'u1',
    offlineLocalId: 'OFF-1-aaaa',
    errorText: 'One or more selected products/add-ons were not found.',
    errorCode: 'NotFound',
    cashierUserId: 'c1',
    cashierName: 'Cora Cashier',
    deviceCreatedAt: '2026-06-10T04:00:00Z',
    receivedAt: '2026-06-10T05:00:00Z',
    quotedTotal: 150,
    status: UnsyncedOrderStatusEnum.Open,
    resolution: null,
    resolvedByName: null,
    resolvedAt: null,
    discardReason: null,
    resultingOrderId: null,
    lineCount: 2,
    ...overrides,
  };
}

function makeDetail(order = makeOrder()): UnsyncedOrderDetailDto {
  return {
    order,
    lines: [
      { productId: 'p1', productName: 'Latte', quantity: 1, quotedPrice: 100, specialInstructions: null, addOns: [] },
      { productId: 'p2', productName: null, quantity: 2, quotedPrice: 25, specialInstructions: null, addOns: [] },
    ],
    paymentMethod: PaymentMethodEnum.Cash,
    amountReceived: 500,
    changeAmount: null,
    tips: null,
    note: null,
    specialInstructions: null,
  };
}

describe('UnsyncedOrders', () => {
  let service: {
    getUnsyncedOrders: ReturnType<typeof vi.fn>;
    getUnsyncedOrder: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    saveAsNote: ReturnType<typeof vi.fn>;
    discard: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let listState: { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };

  function create(saved?: Record<string, unknown>) {
    if (saved) {
      listState.load.mockReturnValue(saved);
    }

    TestBed.configureTestingModule({
      providers: [
        { provide: UnsyncedOrderService, useValue: service },
        { provide: UserService, useValue: { getUsers: () => of([{ id: 'c1', firstName: 'Cora', lastName: 'Cashier' }]) } },
        { provide: AlertService, useValue: alerts },
        { provide: ListStateService, useValue: listState },
      ],
    });
    const fixture = TestBed.createComponent(UnsyncedOrders);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, vm: internals(fixture.componentInstance) };
  }

  const lastQuery = () => service.getUnsyncedOrders.mock.calls.at(-1)![0];

  beforeEach(() => {
    service = {
      getUnsyncedOrders: vi.fn().mockReturnValue(of({ items: [makeOrder()], page: 1, pageSize: 10, totalCount: 1 })),
      getUnsyncedOrder: vi.fn().mockReturnValue(of(makeDetail())),
      retry: vi.fn(),
      saveAsNote: vi.fn().mockReturnValue(of(makeDetail())),
      discard: vi.fn().mockReturnValue(of(makeDetail())),
    };
    alerts = { error: vi.fn(), success: vi.fn() };
    listState = { load: vi.fn().mockImplementation((_key: string, fallback: unknown) => fallback), save: vi.fn() };
  });

  it('lists the open orders by default with queue number, cashier, total and error', () => {
    const { el } = create();

    expect(lastQuery()).toMatchObject({ status: UnsyncedOrderStatusEnum.Open, page: 1, sortBy: 'date', descending: true });
    const row = el.querySelector('[data-unsynced-row]')?.textContent ?? '';
    expect(row).toContain('OFF-1-aaaa');
    expect(row).toContain('Cora Cashier');
    expect(row).toContain('150.00');
    expect(row).toContain('were not found');
  });

  it('shows an empty state', () => {
    service.getUnsyncedOrders.mockReturnValue(of({ items: [], page: 1, pageSize: 10, totalCount: 0 }));
    const { el } = create();

    expect(el.querySelector('[data-testid="unsynced-empty"]')).not.toBeNull();
  });

  it('alerts when the list fails to load', () => {
    service.getUnsyncedOrders.mockReturnValue(throwError(() => new Error('boom')));
    create();

    expect(alerts.error).toHaveBeenCalledWith('boom');
  });

  it('searches by queue number or error after a pause, from page 1', () => {
    const { vm } = create();
    vi.useFakeTimers();
    try {
      vm['searchControl'].setValue('OFF-7');
      vi.advanceTimersByTime(299);
      expect(lastQuery().searchTerm).toBeUndefined();
      vi.advanceTimersByTime(1);

      expect(lastQuery()).toMatchObject({ searchTerm: 'OFF-7', page: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sorts by the clicked column and flips the direction', () => {
    const { vm } = create();

    vm['toggleSort']('total');
    expect(lastQuery()).toMatchObject({ sortBy: 'total', descending: false });
    vm['toggleSort']('total');
    expect(lastQuery()).toMatchObject({ sortBy: 'total', descending: true });
  });

  it('filters by status, cashier and date, and starts again from page 1', () => {
    const { vm } = create();

    vm['goToPage'](1);
    vm['selectStatus']('all');
    expect(lastQuery().status).toBeUndefined();
    vm['selectStatus']('resolved');
    expect(lastQuery().status).toBe(UnsyncedOrderStatusEnum.Resolved);
    vm['selectCashier']('c1');
    expect(lastQuery().cashierId).toBe('c1');
    vm['toggleDateRangeSelection']('7d');
    expect(lastQuery().fromDate).toBeTruthy();
    expect(vm['activeFilterCount']()).toBe(3);
    vm['clearAllFilters']();
    expect(vm['activeFilterCount']()).toBe(0);
    expect(listState.save).toHaveBeenCalled();
  });

  it('opens the detail with the quoted lines, marking an unknown product', () => {
    const { fixture, el, vm } = create();

    vm['openOrder'](makeOrder());
    fixture.detectChanges();

    expect(service.getUnsyncedOrder).toHaveBeenCalledWith('u1');
    const lines = el.querySelector('[data-unsynced-lines]')?.textContent ?? '';
    expect(lines).toContain('Latte');
    expect(lines).toContain('Unknown product');
    expect(el.querySelector('[data-unsynced-actions]')).not.toBeNull();
  });

  it('offers no actions on a resolved order and shows how it was resolved', () => {
    const resolved = makeOrder({
      status: UnsyncedOrderStatusEnum.Resolved,
      resolution: UnsyncedOrderResolutionEnum.Discarded,
      resolvedByName: 'Ana Admin',
      resolvedAt: '2026-06-11T01:00:00Z',
      discardReason: 'Test sale',
    });
    service.getUnsyncedOrder.mockReturnValue(of(makeDetail(resolved)));
    const { fixture, el, vm } = create();

    vm['openOrder'](resolved);
    fixture.detectChanges();

    expect(el.querySelector('[data-unsynced-actions]')).toBeNull();
    const text = el.querySelector('[data-unsynced-resolution]')?.textContent ?? '';
    expect(text).toContain('Discarded');
    expect(text).toContain('Ana Admin');
    expect(text).toContain('Test sale');
  });

  it('asks before each action and does nothing when cancelled', () => {
    const { fixture, el, vm } = create();
    vm['openOrder'](makeOrder());
    fixture.detectChanges();

    vm['askAction']('note');
    fixture.detectChanges();
    expect(el.ownerDocument.querySelector('app-confirm-dialog')).not.toBeNull();
    vm['cancelAction']();
    fixture.detectChanges();

    expect(service.saveAsNote).not.toHaveBeenCalled();
    expect(el.ownerDocument.querySelector('app-confirm-dialog')).toBeNull();
  });

  it('keeps the order open and shows the error when the retry fails again', () => {
    service.retry.mockReturnValue(
      of({ resolved: false, error: 'Still missing', orderId: null, orderNumber: null, order: makeOrder({ errorText: 'Still missing' }) }),
    );
    const { fixture, vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('retry');
    vm['confirmAction']();
    fixture.detectChanges();

    expect(service.retry).toHaveBeenCalledWith('u1');
    expect(alerts.error).toHaveBeenCalledWith('Still missing');
    expect(vm['retryError']()).toBe('Still missing');
    expect(vm['isDetailOpen']()).toBe(true);
    expect(vm['pendingAction']()).toBeNull();
  });

  it('closes the detail and reloads the list after a successful retry', () => {
    service.retry.mockReturnValue(
      of({ resolved: true, error: null, orderId: 'o1', orderNumber: 12, order: makeOrder({ status: UnsyncedOrderStatusEnum.Resolved }) }),
    );
    const { vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('retry');
    const loads = service.getUnsyncedOrders.mock.calls.length;
    vm['confirmAction']();

    expect(alerts.success).toHaveBeenCalledWith('Order #12 was saved.');
    expect(vm['isDetailOpen']()).toBe(false);
    expect(service.getUnsyncedOrders.mock.calls.length).toBe(loads + 1);
  });

  it('saves as a note after confirming', () => {
    const { vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('note');
    vm['confirmAction']();

    expect(service.saveAsNote).toHaveBeenCalledWith('u1');
    expect(alerts.success).toHaveBeenCalled();
    expect(vm['isDetailOpen']()).toBe(false);
  });

  it('will not discard without a reason, then discards with the trimmed one', () => {
    const { vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('discard');

    vm['confirmAction']();
    expect(service.discard).not.toHaveBeenCalled();
    expect(vm['discardError']()).toBeTruthy();

    vm['onReasonInput']('   ');
    vm['confirmAction']();
    expect(service.discard).not.toHaveBeenCalled();

    vm['onReasonInput']('  Test sale  ');
    vm['confirmAction']();
    expect(service.discard).toHaveBeenCalledWith('u1', 'Test sale');
  });

  it('caps the discard reason length', () => {
    const { vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('discard');

    vm['onReasonInput']('x'.repeat(600));

    expect(vm['discardReason']().length).toBe(500);
  });

  it('shows the server error and clears the dialog when an action is refused', () => {
    service.discard.mockReturnValue(throwError(() => new Error('Only open unsynced orders can be discarded.')));
    const { vm } = create();
    vm['openOrder'](makeOrder());
    vm['askAction']('discard');
    vm['onReasonInput']('Duplicate');
    vm['confirmAction']();

    expect(alerts.error).toHaveBeenCalledWith('Only open unsynced orders can be discarded.');
    expect(vm['pendingAction']()).toBeNull();
    expect(vm['isBusy']()).toBe(false);
  });
});
