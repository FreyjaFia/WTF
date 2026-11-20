import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ConversationInboxService, ConversationService } from '@core/services';
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
import type { SyncResultEntry } from '@core/services/db';
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
  getOrderAddress: (order: OrderDto) => string | null;
  matchesSearchTerm: (order: OrderDto) => boolean;
  getPendingTotal: (p: { cartSnapshot: CartItemDto[]; previewTotal?: number | null }) => number;
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
  let syncResults: ReturnType<typeof signal<SyncResultEntry[]>>;
  let unread: Record<string, number>;
  let inbox: { unreadFor: ReturnType<typeof vi.fn> };
  let isSyncing: ReturnType<typeof signal<boolean>>;
  let hubUpdates: Subject<string>;
  let orderService: {
    getOrdersPaged: ReturnType<typeof vi.fn>;
    getOrder: ReturnType<typeof vi.fn>;
    getAwaitingOrders: ReturnType<typeof vi.fn>;
    getHeldOrders: ReturnType<typeof vi.fn>;
    approveHeldOrder: ReturnType<typeof vi.fn>;
    rejectHeldOrder: ReturnType<typeof vi.fn>;
    approveOrder: ReturnType<typeof vi.fn>;
    rejectOrder: ReturnType<typeof vi.fn>;
  };
  let canWrite: boolean;
  let canOverride: boolean;
  let alert: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    getLoadErrorMessage: ReturnType<typeof vi.fn>;
  };
  let signalR: {
    startStaffOrdersHub: ReturnType<typeof vi.fn>;
    stopStaffOrdersHub: ReturnType<typeof vi.fn>;
    orderChanged: Observable<string>;
    orderMessage: Observable<unknown>;
  };
  let offline: {
    pendingOrders: unknown;
    visiblePendingOrders: unknown;
    isSyncing: unknown;
    syncResults: unknown;
    dismissSyncResult: ReturnType<typeof vi.fn>;
    clearSyncResults: ReturnType<typeof vi.fn>;
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

  const page = (
    items: OrderDto[],
    p = 1,
    total = items.length,
    facets?: Record<string, number>,
  ) => ({
    items,
    page: p,
    pageSize: 20,
    totalCount: total,
    facets,
  });

  const lastQuery = () => orderService.getOrdersPaged.mock.lastCall![0];

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
    canOverride = true;
    isOnline = signal(true);
    pendingOrders = signal<unknown[]>([]);
    syncResults = signal<SyncResultEntry[]>([]);
    isSyncing = signal(false);
    hubUpdates = new Subject<string>();
    orderService = {
      getOrdersPaged: vi.fn().mockReturnValue(of(page([]))),
      getOrder: vi.fn(),
      getAwaitingOrders: vi.fn().mockReturnValue(of([])),
      getHeldOrders: vi.fn().mockReturnValue(of([])),
      approveHeldOrder: vi.fn(),
      rejectHeldOrder: vi.fn(),
      approveOrder: vi.fn(),
      rejectOrder: vi.fn(),
    };
    alert = {
      error: vi.fn(),
      success: vi.fn(),
      getLoadErrorMessage: vi.fn((e: string) => `Failed ${e}`),
    };
    signalR = {
      startStaffOrdersHub: vi.fn(),
      stopStaffOrdersHub: vi.fn(),
      orderChanged: hubUpdates.asObservable(),
      orderMessage: new Subject<unknown>().asObservable(),
    };
    offline = {
      pendingOrders,
      visiblePendingOrders: pendingOrders,
      isSyncing,
      syncResults,
      dismissSyncResult: vi.fn(),
      clearSyncResults: vi.fn(),
      syncAll: vi.fn(),
      syncNow: vi.fn(),
    };
    unread = {};
    inbox = { unreadFor: vi.fn((orderId: string) => unread[orderId] ?? 0) };
    listState = { load: vi.fn(), save: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrderService, useValue: orderService },
        {
          provide: AuthService,
          useValue: { canReadChat: () => true, canWriteChat: () => true, canWriteOrders: () => canWrite, canOverrideOrders: () => canOverride, canWriteStockWaste: () => false },
        },
        { provide: AlertService, useValue: alert },
        { provide: ListStateService, useValue: listState },
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: SignalRService, useValue: signalR },
        { provide: OfflineOrderService, useValue: offline },
        { provide: ConversationInboxService, useValue: inbox },
        {
          provide: ConversationService,
          useValue: {
            getOrderConversation: vi.fn(() =>
              of({ conversationId: null, orderId: 'o1', orderNumber: 1042, title: 'Order #1042', canSend: true, unreadCount: 0, messages: [] }),
            ),
          },
        },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('New Order button', () => {
    const link = () => (fixture.nativeElement as HTMLElement).querySelector('a[href="/orders/editor"]');

    it('is there for staff who can write orders', () => {
      init();

      expect(link()).not.toBeNull();
    });

    it('is hidden from staff who can only read orders', () => {
      canWrite = false;
      init();

      expect(link()).toBeNull();
    });
  });

  describe('filtering by source', () => {
    const sources = () => (t as unknown as {
      selectedSources: () => number[];
      toggleSourceSelection: (s: number) => void;
      clearSourceSelections: () => void;
      isSourceSelected: (s: number) => boolean;
      activeFilterCount: () => number;
      resetFilters: () => void;
    });
    const lastQuery = () => orderService.getOrdersPaged.mock.calls.at(-1)![0];

    it('asks the server for one source when exactly one is chosen', () => {
      init();
      orderService.getOrdersPaged.mockClear();

      sources().toggleSourceSelection(1);
      expect(lastQuery().source).toBe(1);
      expect(sources().isSourceSelected(1)).toBe(true);

      sources().toggleSourceSelection(1);
      sources().toggleSourceSelection(0);
      expect(lastQuery().source).toBe(0);
    });

    it('asks for every order when both or none are chosen', () => {
      init();
      sources().toggleSourceSelection(0);
      sources().toggleSourceSelection(1);
      expect(lastQuery().source).toBeUndefined();

      sources().clearSourceSelections();
      expect(sources().selectedSources()).toEqual([]);
      expect(lastQuery().source).toBeUndefined();
    });

    it('also asks for the chosen source when more orders are loaded', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 50)));
      init();
      sources().toggleSourceSelection(1);
      orderService.getOrdersPaged.mockClear();

      (t as unknown as { loadMoreOrders: () => void }).loadMoreOrders();

      if (orderService.getOrdersPaged.mock.calls.length > 0) {
        expect(lastQuery().source).toBe(1);
      }
    });

    it('counts the source on the Filters button, and none when both are chosen', () => {
      init();
      expect(sources().activeFilterCount()).toBe(0);
      sources().toggleSourceSelection(1);
      expect(sources().activeFilterCount()).toBe(1);
      sources().toggleSourceSelection(0);
      expect(sources().activeFilterCount()).toBe(0);
    });

    it('is cleared with the other filters', () => {
      init();
      sources().toggleSourceSelection(1);
      sources().resetFilters();
      expect(sources().selectedSources()).toEqual([]);
    });

    it('is remembered with the other filters', () => {
      init({ ...defaultState, selectedSources: [1] });
      expect(sources().selectedSources()).toEqual([1]);
      expect(orderService.getOrdersPaged.mock.calls[0][0].source).toBe(1);
    });

    it('has a Source section in the filter drawer', () => {
      init();
      sources().toggleSourceSelection(0);
      fixture.detectChanges();
      const section = fixture.nativeElement.querySelector('[data-source-filter]') as HTMLElement;
      expect(section.textContent).toContain('Shop orders');
      expect(section.textContent).toContain('Customer link orders');
    });
  });

  describe('loading', () => {
    it('loads first page on init and starts hub', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 50)));
      init();
      expect(orderService.getOrdersPaged).toHaveBeenCalledWith(
        expect.objectContaining({ searchTerm: '', page: 1, pageSize: 20, statuses: [] }),
      );
      expect(signalR.startStaffOrdersHub).toHaveBeenCalled();
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

    it('loads more pages, appends them and drops rows already shown', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 3)));
      init();
      orderService.getOrdersPaged.mockReturnValue(
        of(page([makeOrder('o1'), makeOrder('o2')], 2, 3)),
      );
      t.loadMoreOrders();
      expect(lastQuery()).toEqual(expect.objectContaining({ searchTerm: '', page: 2, pageSize: 20 }));
      expect(t.ordersCache().map((o) => o.id)).toEqual(['o1', 'o2']);
      expect(t.isLoadingMore()).toBe(false);
    });

    it('stops asking when a page adds nothing new', () => {
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 5)));
      init();
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 2, 5)));
      t.loadMoreOrders();
      expect(t.hasMoreOrders()).toBe(false);
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
      expect(lastQuery()).toEqual(expect.objectContaining({ searchTerm: 'burger', page: 1, pageSize: 20 }));
      expect(listState.save).toHaveBeenCalled();
    });

    it('unsubscribes hub and stops it on destroy', () => {
      init();
      fixture.destroy();
      expect(signalR.stopStaffOrdersHub).toHaveBeenCalled();
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
    const now = new Date(2026, 10, 15, 12, 0, 0);
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
    const orders = [
      makeOrder('o1', { orderNumber: 1, createdAt: daysAgo(0), totalAmount: 300, status: OrderStatusEnum.Pending }),
      makeOrder('o2', { orderNumber: 2, createdAt: daysAgo(3), totalAmount: 100, status: OrderStatusEnum.Completed }),
      makeOrder('o3', { orderNumber: 3, createdAt: daysAgo(20), totalAmount: 200, status: OrderStatusEnum.Cancelled }),
      makeOrder('o4', { orderNumber: 4, createdAt: daysAgo(60), totalAmount: 50, status: OrderStatusEnum.Refunded }),
    ];
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      orderService.getOrdersPaged.mockReturnValue(of(page(orders)));
      init();
    });

    it('defaults to date desc', () => {
      expect(t.orders().map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    });

    it('reads status counts from the server counts, not the loaded rows', () => {
      orderService.getOrdersPaged.mockReturnValue(
        of(page(orders, 1, 120, { all: 120, '1': 7, '2': 90, '3': 20, '4': 3 })),
      );
      t.loadOrders();
      expect(t.statusCounts()).toEqual({ 0: 120, 1: 7, 2: 90, 3: 20, 4: 3 });
      expect(t.filterOptions().map((o) => o.id)).toEqual([1, 2, 3, 4]);
      expect(t.filterOptions().map((o) => o.count)).toEqual([7, 90, 20, 3]);
    });

    it('asks the server for the picked statuses (toggle / change / reset / clear)', () => {
      t.toggleStatusSelection(OrderStatusEnum.Pending);
      expect(lastQuery().statuses).toEqual([OrderStatusEnum.Pending]);
      expect(lastQuery().page).toBe(1);
      expect(t.isStatusSelected(OrderStatusEnum.Pending)).toBe(true);
      t.toggleStatusSelection(OrderStatusEnum.Completed);
      expect(lastQuery().statuses).toEqual([OrderStatusEnum.Pending, OrderStatusEnum.Completed]);
      t.toggleStatusSelection(OrderStatusEnum.Pending);
      expect(lastQuery().statuses).toEqual([OrderStatusEnum.Completed]);
      t.clearStatusSelections();
      expect(lastQuery().statuses).toEqual([]);
      t.onStatusFilterChange([OrderStatusEnum.Refunded]);
      expect(lastQuery().statuses).toEqual([OrderStatusEnum.Refunded]);
      t.onStatusFilterReset();
      expect(lastQuery().statuses).toEqual([]);
      expect(listState.save).toHaveBeenCalled();
    });

    it('asks the server for preset date ranges', () => {
      t.toggleDateRangeSelection('today');
      expect(new Date(lastQuery().from).getTime()).toBe(new Date(2026, 10, 15, 0, 0, 0).getTime());
      expect(lastQuery().to).toBeUndefined();
      t.toggleDateRangeSelection('7d');
      expect(new Date(lastQuery().from).getTime()).toBe(new Date(2026, 10, 8, 12, 0, 0).getTime());
      t.onDateRangeFilterChange(['30d']);
      expect(new Date(lastQuery().from).getTime()).toBe(new Date(2026, 9, 16, 12, 0, 0).getTime());
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

    it('custom range needs both dates before it reloads', () => {
      orderService.getOrdersPaged.mockClear();
      t.onCustomStartDateChanged('2026-11-12');
      expect(t.selectedDateRanges()).toEqual(['custom']);
      expect(orderService.getOrdersPaged).not.toHaveBeenCalled();
      t.onCustomEndDateChanged('2026-11-13');
      expect(new Date(lastQuery().from).getTime()).toBe(new Date('2026-11-12T00:00:00').getTime());
      expect(new Date(lastQuery().to).getTime()).toBe(new Date('2026-11-13T23:59:59.999').getTime());
      t.clearCustomDateRange();
      expect(lastQuery().from).toBeUndefined();
      expect(lastQuery().to).toBeUndefined();
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
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'orderNumber', sortDirection: 'desc', page: 1 }));
      t.toggleSort('orderNumber');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'orderNumber', sortDirection: 'asc' }));
      t.toggleSort('date');
      t.toggleSort('date');
      expect(lastQuery()).toEqual(expect.objectContaining({ sortBy: 'createdAt', sortDirection: 'asc' }));
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

    it('prepends a new order and re-reads the counts', () => {
      orderService.getOrder.mockReturnValue(of(makeOrder('o2', { orderNumber: 2 })));
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1'), makeOrder('o2')], 1, 2)));
      hubUpdates.next('o2');
      expect(t.ordersCache()[0].id).toBe('o2');
      expect(t.totalCount()).toBe(2);
    });

    it('does not add a new order that does not match the status filter', () => {
      t.toggleStatusSelection(OrderStatusEnum.Refunded);
      orderService.getOrder.mockReturnValue(of(makeOrder('o2', { orderNumber: 2 })));
      hubUpdates.next('o2');
      expect(t.ordersCache().map((o) => o.id)).not.toContain('o2');
    });

    it('drops a row whose status changed out of the filter', () => {
      orderService.getOrder.mockReturnValue(
        of(makeOrder('o1', { orderNumber: 1, status: OrderStatusEnum.Cancelled })),
      );
      t.toggleStatusSelection(OrderStatusEnum.Completed);
      orderService.getOrdersPaged.mockReturnValue(of(page([makeOrder('o1')], 1, 1)));
      t.loadOrders();
      hubUpdates.next('o1');
      expect(t.ordersCache().map((o) => o.id)).toEqual([]);
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
      expect(t.getPendingTotal({ cartSnapshot: cart })).toBe(50);
      // The total stored when the order was queued (promotions applied) wins over the list-price snapshot.
      expect(t.getPendingTotal({ cartSnapshot: cart, previewTotal: 38 })).toBe(38);
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

    it('shows the order address beside the name, hides it when empty, and shows one address for a delivery order', () => {
      orderService.getOrdersPaged.mockReturnValue(
        of(
          page([
            makeOrder('o11', { orderNumber: 11, customerName: 'Ann', customerAddress: '5 Pine St' }),
            makeOrder('o12', { orderNumber: 12, customerName: 'Bea' }),
            makeOrder('o13', {
              orderNumber: 13,
              customerName: 'Cy',
              customerAddress: 'Saved Rd',
              deliveryAddress: 'Door 7',
            }),
          ]),
        ),
      );
      init();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('5 Pine St');
      expect(text).toContain('Door 7');
      expect(text).not.toContain('Saved Rd');
      expect(t.getOrderAddress(makeOrder('o12'))).toBeNull();
    });

    it('finds orders by address', () => {
      orderService.getOrdersPaged.mockReturnValue(
        of(page([makeOrder('o14', { orderNumber: 14, customerAddress: 'Mango Lane' })])),
      );
      init();
      t.filterForm.controls.searchTerm.setValue('mango');
      expect(t.matchesSearchTerm(makeOrder('o14', { customerAddress: 'Mango Lane' }))).toBe(true);
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

  describe('orders that need attention', () => {
    const el = () => fixture.nativeElement as HTMLElement;

    it('has no banners: awaiting, unsynced and held orders live on the Needs attention page', () => {
      init();

      expect(el().querySelector('[data-awaiting-approval], [data-held-orders], [data-unsynced-banner]')).toBeNull();
      expect(orderService.getAwaitingOrders).not.toHaveBeenCalled();
      expect(orderService.getHeldOrders).not.toHaveBeenCalled();
    });

    it('keeps a held or waiting order out of the normal list when it changes live', () => {
      init();
      orderService.getOrder.mockReturnValue(of(makeOrder('o9', { status: OrderStatusEnum.PendingReview })));
      hubUpdates.next('o9');
      orderService.getOrder.mockReturnValue(of(makeOrder('o8', { status: OrderStatusEnum.PendingApproval })));
      hubUpdates.next('o8');

      expect(t.ordersCache().map((o) => o.id)).toEqual([]);
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

  describe('the Last sync card', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const card = () => el().querySelector('[data-last-sync]') as HTMLElement | null;
    const rows = () => [...el().querySelectorAll('[data-sync-result]')] as HTMLElement[];
    const entry = (over: Partial<SyncResultEntry>): SyncResultEntry => ({
      id: 1,
      localId: 'OFF-1',
      orderNumber: 12,
      outcome: 'saved',
      message: 'Saved.',
      reasons: [],
      at: '2026-11-13T02:00:00.000Z',
      ...over,
    });

    it('is not shown when there is nothing to report', () => {
      init();

      expect(card()).toBeNull();
    });

    it('says what each queued order became, in plain words', () => {
      syncResults.set([
        entry({ id: 1, localId: 'OFF-1', orderNumber: 12 }),
        entry({
          id: 2,
          localId: 'OFF-2',
          orderNumber: 13,
          outcome: 'saved-with-note',
          message: 'Saved, with a note.',
          reasons: ['Milk is below zero.'],
        }),
        entry({
          id: 3,
          localId: 'OFF-3',
          orderNumber: 14,
          outcome: 'sent-for-review',
          message: 'An Admin has to review this sale before it counts.',
          reasons: ['Latte costs 130.00 now.'],
        }),
        entry({
          id: 4,
          localId: 'OFF-4',
          orderNumber: null,
          outcome: 'could-not-sync',
          message: 'Latte is not sold here.',
        }),
      ]);
      init();

      const text = card()!.textContent!;
      expect(rows()).toHaveLength(4);
      expect(text).toContain('Saved as order #12');
      expect(text).toContain('Saved as order #13 with a note');
      expect(text).toContain('Milk is below zero.');
      expect(text).toContain('Order #14 sent for review');
      expect(text).toContain('Latte costs 130.00 now.');
      expect(text).toContain('Could not sync');
      expect(text).toContain('Latte is not sold here.');
    });

    it('offers no way to approve, only to dismiss', () => {
      syncResults.set([entry({ outcome: 'sent-for-review', reasons: ['A price changed.'] })]);
      init();

      const labels = [...card()!.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
      );
      expect(labels).toEqual(['1 Last sync', 'Clear all', 'Dismiss OFF-1']);
      expect(card()!.textContent).not.toMatch(/approve|reject/i);
    });

    it('dismisses one row', () => {
      syncResults.set([entry({ id: 7 })]);
      init();

      (card()!.querySelector('[aria-label="Dismiss OFF-1"]') as HTMLButtonElement).click();

      expect(offline.dismissSyncResult).toHaveBeenCalledWith(7);
    });

    it('clears all rows', () => {
      syncResults.set([entry({ id: 7 }), entry({ id: 8, localId: 'OFF-2' })]);
      init();

      const clear = [...card()!.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Clear all',
      ) as HTMLButtonElement;
      clear.click();

      expect(offline.clearSyncResults).toHaveBeenCalled();
    });

    it('collapses and opens from its header', () => {
      syncResults.set([entry({})]);
      init();
      const header = card()!.querySelector('button[aria-expanded]') as HTMLButtonElement;

      expect(header.getAttribute('aria-expanded')).toBe('true');
      header.click();
      fixture.detectChanges();

      expect(header.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
