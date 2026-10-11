import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  ListStateService,
  OfflineOrderService,
  OrderService,
  SignalRService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  CartItemDto,
  FulfillmentTypeEnum,
  OrderDto,
  OrderSourceEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
} from '@shared/models';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderList } from './order-list';

interface Internals {
  orders: () => OrderDto[];
  ordersCache: () => OrderDto[];
  isLoading: () => boolean;
  isLoadingMore: () => boolean;
  isRefreshing: () => boolean;
  currentPage: () => number;
  totalCount: () => number;
  hasMoreOrders: () => boolean;
  sortColumn: () => string | null;
  sortDirection: () => string;
  selectedStatuses: () => OrderStatusEnum[];
  selectedDateRanges: () => string[];
  customStartDate: () => string;
  customEndDate: () => string;
  isFiltersOpen: () => boolean;
  groupedOrders: () => { label: string; orders: OrderDto[] }[];
  statusCounts: () => Record<number, number>;
  filterOptions: () => { id: number; count?: number }[];
  selectedDateRangeId: () => string[];
  filterForm: { controls: { searchTerm: { setValue: (v: string) => void } } };
  loadOrders: () => void;
  loadMoreOrders: () => void;
  refresh: () => void;
  onDateRangeFilterChange: (ids: string[]) => void;
  onDateRangeFilterReset: () => void;
  isDateRangeSelected: (id: string) => boolean;
  toggleDateRangeSelection: (id: string) => void;
  clearDateRangeSelections: () => void;
  onCustomStartDateChanged: (v: string) => void;
  onCustomEndDateChanged: (v: string) => void;
  clearCustomDateRange: () => void;
  onStatusFilterChange: (ids: number[]) => void;
  onStatusFilterReset: () => void;
  isStatusSelected: (id: number) => boolean;
  toggleStatusSelection: (id: number) => void;
  clearStatusSelections: () => void;
  openFilters: () => void;
  closeFilters: () => void;
  toggleSort: (c: string) => void;
  resetFilters: () => void;
  getStatusVariant: (s: OrderStatusEnum) => string;
  getStatusLabel: (s: OrderStatusEnum) => string;
  getOrderDate: (o: OrderDto) => string;
  getItemsText: (o: OrderDto) => string;
  openOrder: (o: OrderDto) => void;
  editPendingOrder: (id: string) => void;
  syncPendingOrders: () => void;
  getPendingItemCount: (c: CartItemDto[]) => string;
  getPendingTotal: (c: CartItemDto[]) => number;
  getOrderStatusVariant: (s?: OrderStatusEnum | null) => string;
  getOrderStatusLabel: (s?: OrderStatusEnum | null) => string;
  isSortActive: (c: string) => boolean;
  stopPropagation: (e: Event) => void;
}

const makeOrder = (id: string, over: Partial<OrderDto> = {}): OrderDto => ({
  id,
  orderNumber: Number(id.replace(/\D/g, '')) || 1,
  createdAt: new Date().toISOString(),
  createdBy: 'u',
  items: [],
  status: OrderStatusEnum.Completed,
  totalAmount: 100,
  ...over,
});

describe('OrderList', () => {
  let fixture: ComponentFixture<OrderList>;
  let cmp: OrderList;
  let t: Internals;
  let isOnline: ReturnType<typeof signal<boolean>>;
  let pendingOrders: ReturnType<typeof signal<unknown[]>>;
  let isSyncing: ReturnType<typeof signal<boolean>>;
  let hubUpdates: Subject<string>;
  let orderService: {
    getOrdersPaged: ReturnType<typeof vi.fn>;
    getOrder: ReturnType<typeof vi.fn>;
    getAwaitingOrders: ReturnType<typeof vi.fn>;
    approveOrder: ReturnType<typeof vi.fn>;
    rejectOrder: ReturnType<typeof vi.fn>;
  };
  let canWrite: boolean;
  let alert: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    getLoadErrorMessage: ReturnType<typeof vi.fn>;
  };
  let signalR: {
    startDashboardHub: ReturnType<typeof vi.fn>;
    stopDashboardHub: ReturnType<typeof vi.fn>;
    orderUpdated: Observable<string>;
  };
  let offline: {
    pendingOrders: unknown;
    isSyncing: unknown;
    syncAll: ReturnType<typeof vi.fn>;
    syncNow: ReturnType<typeof vi.fn>;
  };
  let listState: { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let router: Router;

  const defaultState = {
    searchTerm: '',
    selectedStatuses: [],
    selectedDateRanges: [],
    customStartDate: '',
    customEndDate: '',
    sortColumn: null,
    sortDirection: 'desc',
  };

  const page = (items: OrderDto[], p = 1, total = items.length) => ({
    items,
    page: p,
    pageSize: 20,
    totalCount: total,
  });

  const init = (saved: object = defaultState) => {
    listState.load.mockReturnValue(saved);
    fixture = TestBed.createComponent(OrderList);
    cmp = fixture.componentInstance;
    t = cmp as unknown as Internals;
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    canWrite = true;
    isOnline = signal(true);
    pendingOrders = signal<unknown[]>([]);
    isSyncing = signal(false);
    hubUpdates = new Subject<string>();
    orderService = {
      getOrdersPaged: vi.fn().mockReturnValue(of(page([]))),
      getOrder: vi.fn(),
      getAwaitingOrders: vi.fn().mockReturnValue(of([])),
      approveOrder: vi.fn(),
      rejectOrder: vi.fn(),
    };
    alert = {
      error: vi.fn(),
      success: vi.fn(),
      getLoadErrorMessage: vi.fn((e: string) => `Failed ${e}`),
    };
    signalR = {
      startDashboardHub: vi.fn(),
      stopDashboardHub: vi.fn(),
      orderUpdated: hubUpdates.asObservable(),
    };
    offline = { pendingOrders, isSyncing, syncAll: vi.fn(), syncNow: vi.fn() };
    listState = { load: vi.fn(), save: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrderService, useValue: orderService },
        { provide: AuthService, useValue: { canWriteOrders: () => canWrite } },
        { provide: AlertService, useValue: alert },
        { provide: ListStateService, useValue: listState },
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: SignalRService, useValue: signalR },
        { provide: OfflineOrderService, useValue: offline },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('loading', () => {
    it('loads first page on init and starts hub', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 50)));
      init();
      expect(orderService.getOrdersPaged).toHaveBeenCalledWith({
        searchTerm: '',
        page: 1,
        pageSize: 20,
      });
      expect(signalR.startDashboardHub).toHaveBeenCalled();
      expect(t.orders().length).toBe(1);
      expect(t.totalCount()).toBe(50);
      expect(t.isLoading()).toBe(false);
      expect(t.hasMoreOrders()).toBe(true);
    });

    it('restores saved state', () => {
      init({
        ...defaultState,
        searchTerm: 'abc',
        selectedStatuses: [OrderStatusEnum.Pending],
        sortColumn: 'totalAmount',
        sortDirection: 'asc',
      });
      expect(t.selectedStatuses()).toEqual([OrderStatusEnum.Pending]);
      expect(t.sortColumn()).toBe('totalAmount');
      expect(t.sortDirection()).toBe('asc');
      expect(orderService.getOrdersPaged.mock.calls[0][0].searchTerm).toBe('abc');
    });

    it('does not load when offline', () => {
      isOnline.set(false);
      init();
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
    });

    it('shows error and clears loading on failure (falling back to default message)', () => {
      orderService.getOrdersPaged.mockReturnValue(throwError(() => new Error('')));
      init();
      expect(alert.error).toHaveBeenCalledWith('Failed orders');
      expect(t.isLoading()).toBe(false);
    });

    it('uses error message when present', () => {
      orderService.getOrdersPaged.mockReturnValue(throwError(() => new Error('boom')));
      init();
      expect(alert.error).toHaveBeenCalledWith('boom');
    });

    it('loads more pages and appends', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 2)));
      init();
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o2')], 2, 2)));
      t.loadMoreOrders();
      expect(orderService.getOrdersPaged).toHaveBeenLastCalledWith({
        searchTerm: '',
        page: 2,
        pageSize: 20,
      });
      expect(t.ordersCache().map((o) => o.id)).toEqual(['o1', 'o2']);
      expect(t.hasMoreOrders()).toBe(false);
      expect(t.isLoadingMore()).toBe(false);
    });

    it('does not load more when nothing remains, offline or already loading', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 1)));
      init();
      orderService.getOrdersPaged.mockClear();
      t.loadMoreOrders();
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
    });

    it('does not load more when offline', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 5)));
      init();
      orderService.getOrdersPaged.mockClear();
      isOnline.set(false);
      t.loadMoreOrders();
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
    });

    it('load more error alerts and clears flag', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 5)));
      init();
      orderService.getOrdersPaged.mockReturnValue(throwError(() => new Error('nope')));
      t.loadMoreOrders();
      expect(alert.error).toHaveBeenCalledWith('nope');
      expect(t.isLoadingMore()).toBe(false);
    });

    it('refresh reloads and resets refreshing flag; ignored if syncing', () => {
      init();
      orderService.getOrdersPaged.mockClear();
      t.refresh();
      expect(orderService.getOrdersPaged).toHaveBeenCalledTimes(1);
      expect(t.isRefreshing()).toBe(false);

      isSyncing.set(true);
      TestBed.tick();
      orderService.getOrdersPaged.mockClear();
      t.refresh();
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
    });

    it('search term change reloads after debounce and saves state', () => {
      init();
      vi.useFakeTimers();
      orderService.getOrdersPaged.mockClear();
      t.filterForm.controls.searchTerm.setValue('burger');
      vi.advanceTimersByTime(299);
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(orderService.getOrdersPaged).toHaveBeenCalledWith({
        searchTerm: 'burger',
        page: 1,
        pageSize: 20,
      });
      expect(listState.save).toHaveBeenCalled();
    });

    it('unsubscribes hub and stops it on destroy', () => {
      init();
      fixture.destroy();
      expect(signalR.stopDashboardHub).toHaveBeenCalled();
    });
  });

  describe('connectivity effect', () => {
    it('reloads when connection returns with nothing pending', () => {
      isOnline.set(false);
      init();
      orderService.getOrdersPaged.mockClear();
      isOnline.set(true);
      TestBed.tick();
      expect(orderService.getOrdersPaged).toHaveBeenCalledTimes(1);
    });

    it('waits for offline sync when pending orders exist, then reloads', () => {
      isOnline.set(false);
      pendingOrders.set([
        {
          localId: 'a',
          command: { status: OrderStatusEnum.Pending, items: [] },
          cartSnapshot: [],
          customerName: null,
          createdAt: '',
          status: 'pending',
          retryCount: 0,
        },
      ]);
      init();
      orderService.getOrdersPaged.mockClear();
      isOnline.set(true);
      TestBed.tick();
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
      expect(t.isLoading()).toBe(true);

      isSyncing.set(true);
      TestBed.tick();
      isSyncing.set(false);
      pendingOrders.set([]);
      TestBed.tick();
      expect(orderService.getOrdersPaged).toHaveBeenCalledTimes(1);
    });

    it('clears loading/refreshing when going offline', () => {
      init();
      isOnline.set(false);
      TestBed.tick();
      expect(t.isLoading()).toBe(false);
      expect(t.isRefreshing()).toBe(false);
    });
  });

  describe('filters, sorting and grouping', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const orders = [
      makeOrder('o1', { orderNumber: 1, createdAt: daysAgo(0), totalAmount: 300, status: OrderStatusEnum.Pending }),
      makeOrder('o2', { orderNumber: 2, createdAt: daysAgo(3), totalAmount: 100, status: OrderStatusEnum.Completed }),
      makeOrder('o3', { orderNumber: 3, createdAt: daysAgo(20), totalAmount: 200, status: OrderStatusEnum.Cancelled }),
      makeOrder('o4', { orderNumber: 4, createdAt: daysAgo(60), totalAmount: 50, status: OrderStatusEnum.Refunded }),
    ];
    beforeEach(() => {
      orderService.getOrdersPaged.mockReturnValue(of(page(orders)));
      init();
    });

    it('defaults to date desc', () => {
      expect(t.orders().map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    });

    it('computes status counts and filter options', () => {
      expect(t.statusCounts()).toEqual({ 0: 4, 1: 1, 2: 1, 3: 1, 4: 1 });
      expect(t.filterOptions().map((o) => o.id)).toEqual([1, 2, 3, 4]);
    });

    it('filters by status (toggle / change / reset / clear)', () => {
      t.toggleStatusSelection(OrderStatusEnum.Pending);
      expect(t.orders().map((o) => o.id)).toEqual(['o1']);
      expect(t.isStatusSelected(OrderStatusEnum.Pending)).toBe(true);
      t.toggleStatusSelection(OrderStatusEnum.Completed);
      expect(t.orders().length).toBe(2);
      t.toggleStatusSelection(OrderStatusEnum.Pending);
      expect(t.orders().map((o) => o.id)).toEqual(['o2']);
      t.clearStatusSelections();
      expect(t.orders().length).toBe(4);
      t.onStatusFilterChange([OrderStatusEnum.Refunded]);
      expect(t.orders().map((o) => o.id)).toEqual(['o4']);
      t.onStatusFilterReset();
      expect(t.orders().length).toBe(4);
      expect(listState.save).toHaveBeenCalled();
    });

    it('filters by preset date ranges', () => {
      t.toggleDateRangeSelection('today');
      expect(t.orders().map((o) => o.id)).toEqual(['o1']);
      t.toggleDateRangeSelection('7d');
      expect(t.orders().map((o) => o.id)).toEqual(['o1', 'o2']);
      t.onDateRangeFilterChange(['30d']);
      expect(t.orders().map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
      expect(t.isDateRangeSelected('30d')).toBe(true);
      expect(t.selectedDateRangeId()).toEqual(['30d']);
    });

    it('toggling the same range deselects it', () => {
      t.toggleDateRangeSelection('7d');
      t.toggleDateRangeSelection('7d');
      expect(t.selectedDateRanges()).toEqual([]);
      expect(t.orders().length).toBe(4);
    });

    it('empty date selection clears everything', () => {
      t.onDateRangeFilterChange(['custom']);
      t.onCustomStartDateChanged('2020-01-01');
      t.onDateRangeFilterChange([]);
      expect(t.selectedDateRanges()).toEqual([]);
      expect(t.customStartDate()).toBe('');
      t.onDateRangeFilterReset();
      expect(t.orders().length).toBe(4);
    });

    it('custom range filters inclusively, needs both dates', () => {
      const d = new Date(orders[1].createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      t.onCustomStartDateChanged(day);
      expect(t.selectedDateRanges()).toEqual(['custom']);
      expect(t.orders().length).toBe(4);
      t.onCustomEndDateChanged(day);
      expect(t.orders().map((o) => o.id)).toEqual(['o2']);
      t.clearCustomDateRange();
      expect(t.orders().length).toBe(4);
    });

    it('selecting a preset after custom clears custom dates', () => {
      t.onCustomStartDateChanged('2020-01-01');
      t.toggleDateRangeSelection('today');
      expect(t.customStartDate()).toBe('');
      t.clearDateRangeSelections();
      expect(t.selectedDateRanges()).toEqual([]);
    });

    it('sorts by column and toggles direction', () => {
      t.toggleSort('totalAmount');
      expect(t.sortDirection()).toBe('desc');
      expect(t.orders().map((o) => o.totalAmount)).toEqual([300, 200, 100, 50]);
      t.toggleSort('totalAmount');
      expect(t.sortDirection()).toBe('asc');
      expect(t.orders().map((o) => o.totalAmount)).toEqual([50, 100, 200, 300]);
      t.toggleSort('orderNumber');
      expect(t.sortDirection()).toBe('desc');
      expect(t.orders().map((o) => o.orderNumber)).toEqual([4, 3, 2, 1]);
      t.toggleSort('orderNumber');
      expect(t.orders().map((o) => o.orderNumber)).toEqual([1, 2, 3, 4]);
      t.toggleSort('date');
      t.toggleSort('date');
      expect(t.orders().map((o) => o.id)).toEqual(['o4', 'o3', 'o2', 'o1']);
      expect(t.isSortActive('date')).toBe(true);
      expect(t.isSortActive('orderNumber')).toBe(false);
    });

    it('resetFilters clears search, statuses, dates', () => {
      t.toggleStatusSelection(1);
      t.toggleDateRangeSelection('today');
      t.resetFilters();
      expect(t.selectedStatuses()).toEqual([]);
      expect(t.selectedDateRanges()).toEqual([]);
      expect(t.orders().length).toBe(4);
    });

    it('groups orders by day label', () => {
      const groups = t.groupedOrders();
      expect(groups[0].label).toBe('Today');
      expect(groups.length).toBe(4);
      const y = makeOrder('y', { createdAt: daysAgo(1) });
      orderService.getOrdersPaged.mockReturnValue(of(page([orders[0], y])));
      t.loadOrders();
      expect(t.groupedOrders().map((g) => g.label)).toEqual(['Today', 'Yesterday']);
    });

    it('opens and closes filter drawer', () => {
      t.openFilters();
      expect(t.isFiltersOpen()).toBe(true);
      t.closeFilters();
      expect(t.isFiltersOpen()).toBe(false);
    });
  });

  describe('realtime updates', () => {
    beforeEach(() => {
      orderService.getOrdersPaged.mockReturnValue(
        of(page([makeOrder('o1', { orderNumber: 1, customerName: 'Ann' })], 1, 1)),
      );
      init();
    });

    it('replaces an existing order', () => {
      orderService.getOrder.mockReturnValue(
        of(makeOrder('o1', { orderNumber: 1, totalAmount: 999 })),
      );
      hubUpdates.next('o1');
      expect(t.orders()[0].totalAmount).toBe(999);
      expect(t.totalCount()).toBe(1);
    });

    it('prepends a new order and bumps total count', () => {
      orderService.getOrder.mockReturnValue(of(makeOrder('o2', { orderNumber: 2 })));
      hubUpdates.next('o2');
      expect(t.ordersCache()[0].id).toBe('o2');
      expect(t.totalCount()).toBe(2);
    });

    it('ignores a new order that does not match the search term', () => {
      t.filterForm.controls.searchTerm.setValue('zzz');
      orderService.getOrder.mockReturnValue(of(makeOrder('o2', { orderNumber: 2 })));
      hubUpdates.next('o2');
      expect(t.ordersCache().map((o) => o.id)).toEqual(['o1']);
    });

    it('adds a matching new order by customer name without bumping total when searching', () => {
      t.filterForm.controls.searchTerm.setValue('ann');
      orderService.getOrder.mockReturnValue(
        of(makeOrder('o3', { orderNumber: 3, customerName: 'Annie' })),
      );
      hubUpdates.next('o3');
      expect(t.ordersCache().map((o) => o.id)).toEqual(['o3', 'o1']);
      expect(t.totalCount()).toBe(1);
    });

    it('ignores empty ids, offline and fetch errors', () => {
      hubUpdates.next('');
      isOnline.set(false);
      hubUpdates.next('o2');
      expect(orderService.getOrder).not.toHaveBeenCalled();
      isOnline.set(true);
      orderService.getOrder.mockReturnValue(throwError(() => new Error('x')));
      hubUpdates.next('o2');
      expect(t.ordersCache().length).toBe(1);
    });
  });

  describe('helpers and navigation', () => {
    beforeEach(() => init());

    it('maps statuses to variants and labels', () => {
      expect(t.getStatusVariant(OrderStatusEnum.Pending)).toBe('warning');
      expect(t.getStatusVariant(OrderStatusEnum.Completed)).toBe('success');
      expect(t.getStatusVariant(OrderStatusEnum.Cancelled)).toBe('default');
      expect(t.getStatusVariant(OrderStatusEnum.Refunded)).toBe('error');
      expect(t.getStatusVariant(OrderStatusEnum.All)).toBe('info');
      expect(t.getStatusLabel(OrderStatusEnum.Refunded)).toBe('Refunded');
      expect(t.getStatusLabel(OrderStatusEnum.Cancelled)).toBe('Cancelled');
      expect(t.getStatusLabel(OrderStatusEnum.Pending)).toBe('Pending');
      expect(t.getStatusLabel(OrderStatusEnum.Completed)).toBe('Completed');
      expect(t.getStatusLabel(OrderStatusEnum.All)).toBe('Unknown');
      expect(t.getOrderStatusVariant(OrderStatusEnum.Pending)).toBe('warning');
      expect(t.getOrderStatusVariant(OrderStatusEnum.Completed)).toBe('success');
      expect(t.getOrderStatusVariant(null)).toBe('info');
      expect(t.getOrderStatusLabel(OrderStatusEnum.Pending)).toBe('Pending');
      expect(t.getOrderStatusLabel(OrderStatusEnum.Completed)).toBe('Completed');
      expect(t.getOrderStatusLabel(undefined)).toBe('Unknown');
    });

    it('getOrderDate falls back to updatedAt', () => {
      expect(t.getOrderDate(makeOrder('a', { createdAt: '', updatedAt: 'u' }))).toBe('u');
      expect(t.getOrderDate(makeOrder('a', { createdAt: '', updatedAt: null }))).toBe('');
    });

    it('counts items excluding bundle lines and including bundles', () => {
      const one = makeOrder('a', {
        items: [{ id: '1', productId: 'p', productName: 'P', quantity: 1, addOns: [] }],
      });
      expect(t.getItemsText(one)).toBe('1 item');
      const many = makeOrder('b', {
        items: [
          { id: '1', productId: 'p', productName: 'P', quantity: 2, addOns: [] },
          { id: '2', productId: 'q', productName: 'Q', quantity: 5, addOns: [], bundlePromotionId: 'b1' },
        ],
        bundlePromotions: [{ promotionId: 'b1', promotionName: 'B', quantity: 2, unitPrice: 1 }],
      });
      expect(t.getItemsText(many)).toBe('4 items');
    });

    it('opens pending orders in editor and others in details', () => {
      const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      t.openOrder(makeOrder('p1', { status: OrderStatusEnum.Pending }));
      expect(nav).toHaveBeenLastCalledWith(AppRoutes.OrderEditorById('p1'));
      t.openOrder(makeOrder('c1', { status: OrderStatusEnum.Completed }));
      expect(nav).toHaveBeenLastCalledWith(AppRoutes.OrderDetailsById('c1'));
    });

    it('edits offline order via query param', () => {
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      t.editPendingOrder('L1');
      expect(nav).toHaveBeenCalledWith([AppRoutes.OrdersEditor], {
        queryParams: { offline: 'L1' },
      });
    });

    it('syncs pending orders through the Sync Now action, which explains when it cannot run', () => {
      t.syncPendingOrders();
      expect(offline.syncNow).toHaveBeenCalledTimes(1);
      expect(offline.syncAll).not.toHaveBeenCalled();
    });

    it('does not start a sync while the list is refreshing', () => {
      (t as unknown as { isRefreshing: { set: (v: boolean) => void } }).isRefreshing.set(true);
      t.syncPendingOrders();
      expect(offline.syncNow).not.toHaveBeenCalled();
    });

    it('computes pending order totals and counts', () => {
      const cart: CartItemDto[] = [
        { productId: 'p', name: 'P', price: 10, qty: 2, addOns: [{ addOnId: 'a', name: 'A', price: 5 }] },
        { productId: 'q', name: 'Q', price: 20, qty: 1 },
      ];
      expect(t.getPendingTotal(cart)).toBe(50);
      expect(t.getPendingItemCount(cart)).toBe('3 items');
      expect(t.getPendingItemCount([cart[1]])).toBe('1 item');
    });

    it('stopPropagation delegates to the event', () => {
      const e = new Event('click');
      const spy = vi.spyOn(e, 'stopPropagation');
      t.stopPropagation(e);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('template', () => {
    it('renders orders and pending offline orders', () => {
      pendingOrders.set([
        {
          localId: 'LOCAL-1',
          command: { status: OrderStatusEnum.Pending, items: [] },
          cartSnapshot: [{ productId: 'p', name: 'P', price: 10, qty: 1 }],
          customerName: 'Walker',
          createdAt: new Date().toISOString(),
          status: 'failed',
          errorMessage: 'Server said no',
          retryCount: 1,
        },
      ]);
      orderService.getOrdersPaged.mockReturnValue(
        of(page([makeOrder('o7', { orderNumber: 7, customerName: 'Zed' })])),
      );
      init();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('LOCAL-1');
      expect(text).toContain('Server said no');
      expect(text).toContain('Walker');
      expect(text).toContain('Zed');
    });

    it('shows an Overridden badge only on overridden orders (mobile and desktop layouts)', () => {
      orderService.getOrdersPaged.mockReturnValue(
        of(
          page([
            makeOrder('o8', { orderNumber: 8, overriddenAt: '2026-01-02T10:00:00Z', overrideReason: 'Wrong total' }),
            makeOrder('o9', { orderNumber: 9 }),
          ]),
        ),
      );
      init();
      const badges = Array.from(fixture.nativeElement.querySelectorAll('app-badge')) as HTMLElement[];
      const overridden = badges.filter((b) => b.textContent?.trim() === 'Overridden');

      // One order is overridden, rendered once for the mobile row and once for the desktop column.
      expect(overridden).toHaveLength(2);
      expect(overridden.every((b) => b.querySelector('span')?.classList.contains('bg-amber-50'))).toBe(true);
    });
  });

  describe('orders awaiting approval', () => {
    const waiting = (id: string, over: Partial<OrderDto> = {}): OrderDto =>
      makeOrder(id, {
        status: OrderStatusEnum.PendingApproval,
        customerName: 'Maria Cruz',
        totalAmount: 360,
        source: OrderSourceEnum.CustomerLink,
        fulfillmentType: FulfillmentTypeEnum.Pickup,
        contactNumber: '0917 123 4567',
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 500,
        changeAmount: 140,
        items: [
          {
            id: 'i1',
            productId: 'p1',
            productName: 'Latte',
            quantity: 2,
            addOns: [],
          },
        ],
        ...over,
      });

    const el = () => fixture.nativeElement as HTMLElement;
    const banner = () => el().querySelector('[data-awaiting-approval]') as HTMLElement | null;
    const buttons = (label: string) =>
      [...el().querySelectorAll('button')].filter((b) =>
        b.textContent?.trim().startsWith(label),
      ) as HTMLButtonElement[];

    it('loads the waiting orders with the list, oldest first, and shows them in a banner', () => {
      orderService.getAwaitingOrders.mockReturnValue(
        of([
          waiting('o2', { orderNumber: 2, createdAt: '2026-10-11T10:00:00Z' }),
          waiting('o1', { orderNumber: 1, createdAt: '2026-10-11T09:00:00Z' }),
        ]),
      );
      init();

      expect(orderService.getAwaitingOrders).toHaveBeenCalledTimes(1);
      expect((t as unknown as { awaitingOrders: () => OrderDto[] }).awaitingOrders().map((o) => o.id)).toEqual(['o1', 'o2']);
      expect(banner()!.textContent).toContain('Awaiting approval');
      expect(banner()!.textContent).toContain('#1');
      expect(banner()!.textContent).toContain('#2');
    });

    it('shows nothing when no order is waiting', () => {
      init();
      expect(banner()).toBeNull();
    });

    it('shows the customer, how it is handed over, the items, contact, total and the change to prepare', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 1042 })]));
      init();

      const text = banner()!.textContent ?? '';
      expect(text).toContain('#1042');
      expect(text).toContain('Maria Cruz');
      expect(text).toContain('Pickup');
      expect(text).toContain('2x Latte');
      expect(text).toContain('0917 123 4567');
      expect(text).toContain('360.00');
      expect(text).toContain('Cash');
      expect(text).toContain('prepare change');
      expect(text).toContain('140.00');
    });

    it('shows the tip the customer plans to leave', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { tips: 20 })]));
      init();

      expect(banner()!.textContent).toContain('Tip');
      expect(banner()!.textContent).toContain('20.00');
    });

    it('shows no tip when there is none', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { tips: null })]));
      init();

      expect(banner()!.textContent).not.toContain('Tip');
    });

    it('shows the address and the notes for a delivery', () => {
      orderService.getAwaitingOrders.mockReturnValue(
        of([
          waiting('o1', {
            fulfillmentType: FulfillmentTypeEnum.Delivery,
            deliveryAddress: '5 Side St',
            specialInstructions: 'No ice',
            paymentMethod: PaymentMethodEnum.GCash,
            changeAmount: null,
          }),
        ]),
      );
      init();

      const text = banner()!.textContent ?? '';
      expect(text).toContain('Delivery');
      expect(text).toContain('5 Side St');
      expect(text).toContain('No ice');
      expect(text).toContain('GCash');
      expect(text).not.toContain('prepare change');
    });

    it('keeps waiting orders out of the normal list and the filter counts', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o9')]));
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')])));
      init();

      expect(t.ordersCache().map((o) => o.id)).toEqual(['o1']);
      expect(t.orders().map((o) => o.id)).toEqual(['o1']);
    });

    it('tolerates the banner request failing', () => {
      orderService.getAwaitingOrders.mockReturnValue(throwError(() => new Error('x')));
      init();

      expect(banner()).toBeNull();
      expect(alert.error).not.toHaveBeenCalled();
    });

    it('does not ask for waiting orders while offline', () => {
      isOnline.set(false);
      init();
      expect(orderService.getAwaitingOrders).not.toHaveBeenCalled();
    });

    it('opens the order details when a waiting order is tapped', () => {
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
      init();

      (el().querySelector('[aria-label="Open order 1"]') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
    });

    describe('accepting', () => {
      it('accepts the order, takes it off the banner, puts it in the list and says so', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 7 })]));
        orderService.approveOrder.mockReturnValue(
          of(makeOrder('o1', { orderNumber: 7, status: OrderStatusEnum.Pending })),
        );
        init();

        buttons('Accept')[0].click();
        fixture.detectChanges();

        expect(orderService.approveOrder).toHaveBeenCalledWith('o1');
        expect(banner()).toBeNull();
        expect(t.ordersCache()[0]).toMatchObject({ id: 'o1', status: OrderStatusEnum.Pending });
        expect(alert.success).toHaveBeenCalledWith('Order #7 accepted.');
      });

      it('blocks both buttons while the answer is being sent', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
        orderService.approveOrder.mockReturnValue(new Subject());
        init();

        buttons('Accept')[0].click();
        fixture.detectChanges();

        expect(el().textContent).toContain('Accepting...');
        expect(buttons('Reject')[0].disabled).toBe(true);
        expect(buttons('Accepting')[0].disabled).toBe(true);
        buttons('Accepting')[0].click();
        expect(orderService.approveOrder).toHaveBeenCalledTimes(1);
      });

      it('shows the error and refreshes the banner when it cannot be accepted', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
        orderService.approveOrder.mockReturnValue(
          throwError(() => new Error('This order is no longer waiting for approval.')),
        );
        init();
        orderService.getAwaitingOrders.mockClear();
        orderService.getAwaitingOrders.mockReturnValue(of([]));

        buttons('Accept')[0].click();
        fixture.detectChanges();

        expect(alert.error).toHaveBeenCalledWith('This order is no longer waiting for approval.');
        expect(orderService.getAwaitingOrders).toHaveBeenCalledTimes(1);
        expect(banner()).toBeNull();
      });
    });

    describe('rejecting', () => {
      const start = () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 7 })]));
        init();
        buttons('Reject')[0].click();
        fixture.detectChanges();
      };
      const dialog = () => el().querySelector('app-reject-order-dialog') as HTMLElement | null;
      const typeReason = (value: string) => {
        const area = dialog()!.querySelector('textarea') as HTMLTextAreaElement;
        area.value = value;
        area.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      const confirm = () =>
        ([...dialog()!.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Reject Order'),
        ) as HTMLButtonElement).click();

      it('asks for a reason first and sends nothing until there is one', () => {
        start();

        expect(dialog()).not.toBeNull();
        expect(dialog()!.textContent).toContain('Reject Order #7?');
        confirm();
        fixture.detectChanges();

        expect(orderService.rejectOrder).not.toHaveBeenCalled();
        expect(dialog()!.textContent).toContain('Please enter a reason');
      });

      it('rejects with the reason, takes the order off the banner, files it as cancelled and says so', () => {
        orderService.rejectOrder.mockReturnValue(
          of(makeOrder('o1', { orderNumber: 7, status: OrderStatusEnum.Cancelled, rejectionReason: 'Closed' })),
        );
        start();

        typeReason('Closed');
        confirm();
        fixture.detectChanges();

        expect(orderService.rejectOrder).toHaveBeenCalledWith('o1', 'Closed');
        expect(dialog()).toBeNull();
        expect(banner()).toBeNull();
        expect(t.ordersCache()[0]).toMatchObject({ id: 'o1', status: OrderStatusEnum.Cancelled });
        expect(alert.success).toHaveBeenCalledWith('Order #7 rejected.');
      });

      it('can be cancelled without rejecting', () => {
        start();
        ([...dialog()!.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Cancel'),
        ) as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(dialog()).toBeNull();
        expect(orderService.rejectOrder).not.toHaveBeenCalled();
        expect(banner()).not.toBeNull();
      });

      it('shows the error, closes the dialog and refreshes the banner when it fails', () => {
        orderService.rejectOrder.mockReturnValue(throwError(() => new Error('nope')));
        start();
        orderService.getAwaitingOrders.mockClear();
        orderService.getAwaitingOrders.mockReturnValue(of([]));

        typeReason('Closed');
        confirm();
        fixture.detectChanges();

        expect(alert.error).toHaveBeenCalledWith('nope');
        expect(dialog()).toBeNull();
        expect(orderService.getAwaitingOrders).toHaveBeenCalledTimes(1);
      });

      it('cannot be cancelled or repeated while the answer is being sent', () => {
        orderService.rejectOrder.mockReturnValue(new Subject());
        start();
        typeReason('Closed');
        confirm();
        fixture.detectChanges();

        const internals = t as unknown as {
          cancelRejectAwaiting: () => void;
          confirmRejectAwaiting: (reason: string) => void;
        };
        internals.cancelRejectAwaiting();
        internals.confirmRejectAwaiting('Closed');

        expect(dialog()).not.toBeNull();
        expect(orderService.rejectOrder).toHaveBeenCalledTimes(1);
      });
    });

    describe('without permission to answer orders', () => {
      it('shows the waiting orders but no Accept or Reject buttons', () => {
        canWrite = false;
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            provideRouter([]),
            { provide: OrderService, useValue: orderService },
            { provide: AuthService, useValue: { canWriteOrders: () => false } },
            { provide: AlertService, useValue: alert },
            { provide: ListStateService, useValue: listState },
            { provide: ConnectivityService, useValue: { isOnline } },
            { provide: SignalRService, useValue: signalR },
            { provide: OfflineOrderService, useValue: offline },
          ],
        });
        init();

        expect(banner()).not.toBeNull();
        expect(buttons('Accept').length).toBe(0);
        expect(buttons('Reject').length).toBe(0);
        (t as unknown as { approveAwaiting: (o: OrderDto) => void }).approveAwaiting(waiting('o1'));
        expect(orderService.approveOrder).not.toHaveBeenCalled();
      });
    });

    describe('live updates', () => {
      it('adds a new waiting order to the banner and not to the normal list', () => {
        init();
        orderService.getOrder.mockReturnValue(of(waiting('o5', { orderNumber: 5 })));

        hubUpdates.next('o5');
        fixture.detectChanges();

        expect(banner()!.textContent).toContain('#5');
        expect(t.ordersCache().map((o) => o.id)).not.toContain('o5');
        expect(t.totalCount()).toBe(0);
      });

      it('updates a waiting order that changed without duplicating it', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o5', { totalAmount: 100 })]));
        init();
        orderService.getOrder.mockReturnValue(of(waiting('o5', { totalAmount: 250 })));

        hubUpdates.next('o5');
        fixture.detectChanges();

        const list = (t as unknown as { awaitingOrders: () => OrderDto[] }).awaitingOrders();
        expect(list.length).toBe(1);
        expect(list[0].totalAmount).toBe(250);
      });

      it('moves an order to the normal list when someone else accepts it', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o5', { orderNumber: 5 })]));
        init();
        orderService.getOrder.mockReturnValue(
          of(makeOrder('o5', { orderNumber: 5, status: OrderStatusEnum.Pending })),
        );

        hubUpdates.next('o5');
        fixture.detectChanges();

        expect(banner()).toBeNull();
        expect(t.ordersCache()[0]).toMatchObject({ id: 'o5', status: OrderStatusEnum.Pending });
      });

      it('moves an order to the normal list when someone else rejects it', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o5', { orderNumber: 5 })]));
        init();
        orderService.getOrder.mockReturnValue(
          of(makeOrder('o5', { orderNumber: 5, status: OrderStatusEnum.Cancelled })),
        );

        hubUpdates.next('o5');
        fixture.detectChanges();

        expect(banner()).toBeNull();
        expect(t.ordersCache()[0]).toMatchObject({ id: 'o5', status: OrderStatusEnum.Cancelled });
      });
    });

    describe('refreshing', () => {
      it('reloads the waiting orders whenever the list is reloaded', () => {
        init();
        orderService.getAwaitingOrders.mockClear();

        t.loadOrders();

        expect(orderService.getAwaitingOrders).toHaveBeenCalledTimes(1);
      });
    });

    describe('status badge', () => {
      it('has its own label and amber color', () => {
        init();
        expect(t.getStatusLabel(OrderStatusEnum.PendingApproval)).toBe('Awaiting approval');
        expect(t.getStatusVariant(OrderStatusEnum.PendingApproval)).toBe('amber');
      });
    });
  });
  describe('filter count on the Filters button', () => {
    it('counts the chosen statuses and the date range', () => {
      init();
      const count = () => (t as unknown as { activeFilterCount: () => number }).activeFilterCount();
      expect(count()).toBe(0);

      (t as unknown as { selectedStatuses: { set: (v: unknown) => void } }).selectedStatuses.set([1, 2]);
      expect(count()).toBe(2);

      (t as unknown as { selectedDateRanges: { set: (v: unknown) => void } }).selectedDateRanges.set(['today']);
      expect(count()).toBe(3);
    });
  });
});
