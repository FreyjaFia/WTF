import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { fakeAlert, internals } from '@app/testing/management-spec-helpers';
import { AlertService, HeldOrderService, ModalStackService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import { BulkApproveResultDto, HeldOrderRowDto, HeldOrdersDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeldOrders } from './held-orders';

function row(overrides: Partial<HeldOrderRowDto> = {}): HeldOrderRowDto {
  return {
    id: 'o1',
    orderNumber: 101,
    createdAt: '2026-11-10T02:00:00Z',
    cashierId: 'u1',
    cashierName: 'Ana Cruz',
    customerName: null,
    amount: 150,
    itemsText: '1 x Latte',
    reasonCodes: ['PriceChanged'],
    reasons: ['Latte: the price is now 160'],
    isAged: false,
    ageDays: 0,
    seniorPwdDiscount: 0,
    ...overrides,
  };
}

function held(items: HeldOrderRowDto[]): HeldOrdersDto {
  return {
    items,
    totalCount: items.length,
    totalAmount: items.reduce((sum, o) => sum + o.amount, 0),
    agedCount: items.filter((o) => o.isAged).length,
    agedAmount: items.filter((o) => o.isAged).reduce((sum, o) => sum + o.amount, 0),
    agedAfterDays: 2,
  };
}

function bulk(overrides: Partial<BulkApproveResultDto> = {}): BulkApproveResultDto {
  return {
    preview: true,
    count: 2,
    totalAmount: 250.5,
    skippedCount: 0,
    failedCount: 0,
    truncated: false,
    items: [],
    ...overrides,
  };
}

describe('HeldOrders', () => {
  let service: { getHeldOrders: ReturnType<typeof vi.fn>; bulkApprove: ReturnType<typeof vi.fn> };
  let alerts: ReturnType<typeof fakeAlert> & {
    warning: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let modalStack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
  let queryParams: Record<string, string>;

  const orders = [
    row({ id: 'a', orderNumber: 3, amount: 100, cashierName: 'Ben', createdAt: '2026-11-09T02:00:00Z', isAged: true, ageDays: 4 }),
    row({ id: 'b', orderNumber: 1, amount: 50.5, cashierName: 'Ana', createdAt: '2026-11-11T02:00:00Z', reasons: ['Cup: unavailable'], reasonCodes: ['ProductInactive'] }),
    row({ id: 'c', orderNumber: 2, amount: 75, cashierName: 'Cy', createdAt: '2026-11-10T02:00:00Z', reasonCodes: ['SeniorPwdDisabled'], reasons: ['Senior/PWD switched off'] }),
  ];

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: HeldOrderService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: modalStack },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    });
    const fixture = TestBed.createComponent(HeldOrders);
    fixture.detectChanges();
    return fixture;
  }

  type Held = {
    sortedOrders: () => HeldOrderRowDto[];
    toggleSort: (column: 'order' | 'reasons' | 'cashier' | 'sold' | 'value') => void;
    sortDirection: () => string;
    toggleSelected: (order: HeldOrderRowDto) => void;
    toggleSelectAll: () => void;
    selectedIds: () => ReadonlySet<string>;
    selectedTotal: () => number;
    isBulkSkipped: (order: HeldOrderRowDto) => boolean;
    askApproveSelected: () => void;
    askApproveMatching: () => void;
    confirmBulk: () => void;
    cancelBulk: () => void;
    toggleReason: (code: string) => void;
    toggleAgedOnly: () => void;
    setCashier: (id: string) => void;
    setDatePreset: (preset: 'all' | 'today' | 'week' | 'month') => void;
    bulkRequest: () => unknown;
    search: { set: (value: string) => void };
    activeFilterCount: () => number;
    openOrder: (order: HeldOrderRowDto) => void;
  };

  function open(): { fixture: ReturnType<typeof create>; component: Held } {
    const fixture = create();
    return { fixture, component: internals(fixture.componentInstance) as unknown as Held };
  }

  function lastFilter(): Record<string, unknown> {
    return service.getHeldOrders.mock.calls.at(-1)![0];
  }

  beforeEach(() => {
    service = {
      getHeldOrders: vi.fn(() => of(held(orders))),
      bulkApprove: vi.fn(() => of(bulk())),
    };
    alerts = { ...fakeAlert(), warning: vi.fn(), info: vi.fn() };
    modalStack = { push: vi.fn(() => 5), remove: vi.fn() };
    router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn() };
    queryParams = {};
  });

  it('lists the held orders oldest first with the aged badge and the reasons', () => {
    const { fixture, component } = open();
    const text = fixture.nativeElement.textContent as string;

    expect(component.sortedOrders().map((o) => o.id)).toEqual(['a', 'c', 'b']);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="aged-badge"]').length).toBe(1);
    expect(text).toContain('Aged');
    expect(text).toContain('Latte: the price is now 160');
    expect(text).toContain('3 waiting');
    expect(text).toContain('PHP 225.50');
  });

  it('shows the empty state when nothing is held', () => {
    service.getHeldOrders.mockReturnValue(of(held([])));
    const { fixture } = open();

    expect(fixture.nativeElement.querySelector('[data-testid="held-empty"]')).not.toBeNull();
  });

  it('starts on aged orders when opened from the dashboard or the reminder', () => {
    queryParams = { agedOnly: 'true' };
    open();

    expect(lastFilter()['agedOnly']).toBe(true);
  });

  it('sorts from the column headers and reverses when picked again', () => {
    const { component } = open();

    component.toggleSort('value');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['b', 'c', 'a']);
    component.toggleSort('value');
    expect(component.sortDirection()).toBe('desc');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['a', 'c', 'b']);
    component.toggleSort('cashier');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['b', 'a', 'c']);
    component.toggleSort('order');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('searches the order number, cashier and reasons', () => {
    const { component } = open();

    component.search.set('cup');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['b']);
    component.search.set('#3');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['a']);
    component.search.set('ben');
    expect(component.sortedOrders().map((o) => o.id)).toEqual(['a']);
  });

  it('reloads with the chosen reason, cashier, date and aged filters and counts them', () => {
    const { component } = open();

    component.toggleReason('PriceChanged');
    component.setCashier('u1');
    component.setDatePreset('week');
    component.toggleAgedOnly();

    const filter = lastFilter();
    expect(filter['reasonCodes']).toEqual(['PriceChanged']);
    expect(filter['cashierId']).toBe('u1');
    expect(filter['agedOnly']).toBe(true);
    expect(filter['fromDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filter['toDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(component.activeFilterCount()).toBe(4);
  });

  it('keeps Senior/PWD holds out of the selection unless their code is filtered on purpose', () => {
    const { component } = open();
    const senior = orders[2];

    expect(component.isBulkSkipped(senior)).toBe(true);
    component.toggleSelected(senior);
    expect(component.selectedIds().size).toBe(0);

    component.toggleSelectAll();
    expect([...component.selectedIds()].sort()).toEqual(['a', 'b']);

    component.toggleReason('SeniorPwdDisabled');
    expect(component.isBulkSkipped(senior)).toBe(false);
  });

  it('adds up the selected orders exactly', () => {
    const { component } = open();

    component.toggleSelected(orders[0]);
    component.toggleSelected(orders[1]);

    expect(component.selectedTotal()).toBe(150.5);
  });

  it('previews the selected orders first and approves only after the confirm', () => {
    const { fixture, component } = open();
    component.toggleSelected(orders[0]);
    component.toggleSelected(orders[1]);
    fixture.detectChanges();

    component.askApproveSelected();
    fixture.detectChanges();

    expect(service.bulkApprove).toHaveBeenCalledTimes(1);
    expect(service.bulkApprove.mock.calls[0][1]).toBe(true);
    expect(service.bulkApprove.mock.calls[0][0].ids).toEqual(['a', 'b']);
    expect(modalStack.push).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="bulk-count"]').textContent.trim()).toBe('2');
    expect(fixture.nativeElement.querySelector('[data-testid="bulk-total"]').textContent).toContain('250.50');

    service.bulkApprove.mockReturnValue(of(bulk({ preview: false })));
    component.confirmBulk();

    expect(service.bulkApprove).toHaveBeenCalledTimes(2);
    expect(service.bulkApprove.mock.calls[1][1]).toBe(false);
    expect(alerts.success).toHaveBeenCalledWith('2 orders approved (PHP 250.50).');
    expect(component.selectedIds().size).toBe(0);
    expect(component.bulkRequest()).toBeNull();
  });

  it('approves everything matching the filters without ids', () => {
    const { component } = open();
    component.toggleReason('PriceChanged');

    component.askApproveMatching();

    const [filter, preview] = service.bulkApprove.mock.calls[0];
    expect(preview).toBe(true);
    expect(filter.ids).toBeUndefined();
    expect(filter.reasonCodes).toEqual(['PriceChanged']);
  });

  it('limits approve-all to the rows on screen while a search is active', () => {
    const { component } = open();
    component.search.set('cup');

    component.askApproveMatching();

    expect(service.bulkApprove.mock.calls[0][0].ids).toEqual(['b']);
  });

  it('does not open the dialog when nothing can be approved', () => {
    service.bulkApprove.mockReturnValue(of(bulk({ count: 0, totalAmount: 0, skippedCount: 1 })));
    const { component } = open();

    component.askApproveMatching();

    expect(alerts.info).toHaveBeenCalled();
    expect(component.bulkRequest()).toBeNull();
    expect(modalStack.push).not.toHaveBeenCalled();
  });

  it('says what was left for a person to look at after a partial approve', () => {
    const { component } = open();
    component.askApproveMatching();
    service.bulkApprove.mockReturnValue(of(bulk({ preview: false, count: 1, totalAmount: 100, failedCount: 1, skippedCount: 1 })));

    component.confirmBulk();

    expect(alerts.warning).toHaveBeenCalledWith('1 order approved (PHP 100.00). 2 orders were left for you to look at.');
  });

  it('shows the Senior/PWD skip note in the confirm dialog', () => {
    service.bulkApprove.mockReturnValue(
      of(bulk({ skippedCount: 1, items: [{ id: 'c', amount: 75, outcome: 'SkippedSeniorPwd' }] })),
    );
    const { fixture, component } = open();

    component.askApproveMatching();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="bulk-skipped-seniorpwd"]')).not.toBeNull();
  });

  it('reports a failed approve and reloads the list', () => {
    const { component } = open();
    component.askApproveMatching();
    service.bulkApprove.mockReturnValue(throwError(() => new Error('down')));
    const loads = service.getHeldOrders.mock.calls.length;

    component.confirmBulk();

    expect(alerts.error).toHaveBeenCalledWith('down');
    expect(service.getHeldOrders.mock.calls.length).toBe(loads + 1);
  });

  it('closing the dialog approves nothing', () => {
    const { component } = open();
    component.askApproveMatching();

    component.cancelBulk();

    expect(component.bulkRequest()).toBeNull();
    expect(modalStack.remove).toHaveBeenCalledWith(5);
    expect(service.bulkApprove).toHaveBeenCalledTimes(1);
  });

  it('opens the order details box for the per-order buttons', () => {
    const { component } = open();

    component.openOrder(orders[0]);

    expect(router.navigateByUrl).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('a'));
  });

  it('drops a selected order that is no longer held after a reload', () => {
    const { component } = open();
    component.toggleSelected(orders[0]);
    service.getHeldOrders.mockReturnValue(of(held([orders[1]])));

    component.toggleAgedOnly();

    expect(component.selectedIds().size).toBe(0);
  });
});
