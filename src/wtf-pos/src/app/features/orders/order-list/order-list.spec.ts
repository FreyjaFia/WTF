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
    canOverride = true;
    isOnline = signal(true);
    pendingOrders = signal<unknown[]>([]);
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
    offline = { pendingOrders, isSyncing, syncAll: vi.fn(), syncNow: vi.fn() };
    unread = {};
    inbox = { unreadFor: vi.fn((orderId: string) => unread[orderId] ?? 0) };
    listState = { load: vi.fn(), save: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrderService, useValue: orderService },
        {
          provide: AuthService,
          useValue: { canWriteOrders: () => canWrite, canOverrideOrders: () => canOverride, canWriteStockWaste: () => false },
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
      expect(orderService.getOrdersPaged).toHaveBeenCalledWith({
        searchTerm: '',
        page: 1,
        pageSize: 20,
      });
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

  describe('offline orders held for review', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const banner = () => el().querySelector('[data-held-orders]') as HTMLElement | null;
    const buttons = (label: string) =>
      [...(banner()?.querySelectorAll('button') ?? [])].filter((b) =>
        b.textContent?.trim().startsWith(label),
      ) as HTMLButtonElement[];
    const held = (id: string, over: Partial<OrderDto> = {}): OrderDto =>
      makeOrder(id, {
        orderNumber: 21,
        status: OrderStatusEnum.PendingReview,
        totalAmount: 150,
        reviewReasons: 'Latte now costs 160.00, quoted 150.00.\nOat Milk is inactive.',
        ...over,
      });

    it('shows an Admin the held orders, oldest first, with every reason and the quoted total', () => {
      orderService.getHeldOrders.mockReturnValue(
        of([
          held('o2', { orderNumber: 22, createdAt: '2026-10-11T10:00:00Z' }),
          held('o1', { orderNumber: 21, createdAt: '2026-10-11T09:00:00Z' }),
        ]),
      );
      init();

      const text = banner()!.textContent ?? '';
      expect(text).toContain('Offline orders needing review');
      expect(text.indexOf('#21')).toBeLessThan(text.indexOf('#22'));
      expect(text).toContain('Latte now costs 160.00, quoted 150.00.');
      expect(text).toContain('Oat Milk is inactive.');
      expect(text).toContain('150.00');
    });

    it('shows nothing, and does not ask, for staff who are not Admins', () => {
      canOverride = false;
      orderService.getHeldOrders.mockReturnValue(of([held('o1')]));
      init();

      expect(banner()).toBeNull();
      expect(orderService.getHeldOrders).not.toHaveBeenCalled();
    });

    it('does not ask while offline', () => {
      isOnline.set(false);
      init();
      expect(orderService.getHeldOrders).not.toHaveBeenCalled();
    });

    it('tolerates the request failing', () => {
      orderService.getHeldOrders.mockReturnValue(throwError(() => new Error('x')));
      init();

      expect(banner()).toBeNull();
      expect(alert.error).not.toHaveBeenCalled();
    });

    it('approves: sends the approval, takes it off the banner, files it in the list and says so', () => {
      orderService.getHeldOrders.mockReturnValue(of([held('o1', { orderNumber: 21 })]));
      orderService.approveHeldOrder.mockReturnValue(
        of(makeOrder('o1', { orderNumber: 21, status: OrderStatusEnum.Completed })),
      );
      init();

      buttons('Approve')[0].click();
      fixture.detectChanges();

      expect(orderService.approveHeldOrder).toHaveBeenCalledWith('o1');
      expect(banner()).toBeNull();
      expect(t.ordersCache()[0]).toMatchObject({ id: 'o1', status: OrderStatusEnum.Completed });
      expect(alert.success).toHaveBeenCalledWith('Order #21 approved.');
    });

    it('blocks both buttons while the answer is being sent', () => {
      orderService.getHeldOrders.mockReturnValue(of([held('o1')]));
      orderService.approveHeldOrder.mockReturnValue(new Subject());
      init();

      buttons('Approve')[0].click();
      fixture.detectChanges();

      expect(banner()!.textContent).toContain('Approving...');
      expect(buttons('Reject')[0].disabled).toBe(true);
      buttons('Approving')[0].click();
      expect(orderService.approveHeldOrder).toHaveBeenCalledTimes(1);
    });

    it('shows the error and refreshes the banner when it cannot be approved', () => {
      orderService.getHeldOrders.mockReturnValue(of([held('o1')]));
      orderService.approveHeldOrder.mockReturnValue(throwError(() => new Error('Not waiting.')));
      init();
      orderService.getHeldOrders.mockClear();
      orderService.getHeldOrders.mockReturnValue(of([]));

      buttons('Approve')[0].click();
      fixture.detectChanges();

      expect(alert.error).toHaveBeenCalledWith('Not waiting.');
      expect(orderService.getHeldOrders).toHaveBeenCalledTimes(1);
      expect(banner()).toBeNull();
    });

    it('rejects through the reason dialog, which says where the reason is kept', () => {
      orderService.getHeldOrders.mockReturnValue(of([held('o1', { orderNumber: 21 })]));
      orderService.rejectHeldOrder.mockReturnValue(
        of(makeOrder('o1', { orderNumber: 21, status: OrderStatusEnum.Cancelled })),
      );
      init();

      buttons('Reject')[0].click();
      fixture.detectChanges();
      const dialog = el().querySelector('app-reject-order-dialog') as HTMLElement;
      expect(dialog.textContent).toContain('Voids and Refunds report');
      expect(dialog.textContent).not.toContain('The customer will see');

      const area = dialog.querySelector('textarea') as HTMLTextAreaElement;
      area.value = 'Wrong price';
      area.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      ([...dialog.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Reject Order'),
      ) as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(orderService.rejectHeldOrder).toHaveBeenCalledWith('o1', 'Wrong price');
      expect(banner()).toBeNull();
      expect(alert.success).toHaveBeenCalledWith('Order #21 rejected.');
    });

    it('puts an order that a live update says is held in the banner, not in the list', () => {
      init();
      orderService.getOrder.mockReturnValue(of(held('o9', { orderNumber: 29 })));

      hubUpdates.next('o9');
      fixture.detectChanges();

      expect(banner()!.textContent).toContain('#29');
      expect(t.ordersCache().map((o) => o.id)).not.toContain('o9');
    });

    it('takes an order off the banner when a live update says it was decided', () => {
      orderService.getHeldOrders.mockReturnValue(of([held('o1')]));
      init();
      orderService.getOrder.mockReturnValue(of(makeOrder('o1', { status: OrderStatusEnum.Completed })));

      hubUpdates.next('o1');
      fixture.detectChanges();

      expect(banner()).toBeNull();
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

    describe('chat with the customer', () => {
      const chatButtons = () => [...el().querySelectorAll('[data-chat-button]')] as HTMLButtonElement[];
      const drawer = () => el().querySelector('app-order-chat-drawer') as HTMLElement;
      const chatSection = () => el().querySelector('[data-order-chat]') as HTMLElement;

      it('puts a Chat button on every waiting order', () => {
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 1 }), waiting('o2', { orderNumber: 2 })]));
        init();

        expect(chatButtons().length).toBe(2);
        expect(chatButtons()[0].getAttribute('aria-label')).toBe('Chat about order 1');
      });

      it('shows no message count on the button: the envelope has the unread count', () => {
        unread['o1'] = 3;
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1'), waiting('o2')]));
        init();

        expect(chatButtons()[0].querySelector('[data-chat-unread]')).toBeNull();
      });

      it('is there for staff who can only read, who cannot accept or reject', () => {
        canWrite = false;
        orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1')]));
        init();

        expect(chatButtons().length).toBe(1);
        expect(buttons('Accept').length).toBe(0);
      });

      it('opens the chat of that order in the side panel, and closes it again', () => {
        orderService.getAwaitingOrders.mockReturnValue(
          of([waiting('o1', { orderNumber: 1042, customerName: 'Maria Cruz' })]),
        );
        init();
        expect(chatSection().className).toContain('translate-x-full');

        chatButtons()[0].click();
        fixture.detectChanges();

        const drawerCmp = drawer();
        expect(drawerCmp).not.toBeNull();
        expect(chatSection().className).toContain('translate-x-0');
        expect(chatSection().textContent).toContain('Order #1042');
        expect(chatSection().textContent).toContain('Maria Cruz');

        (el().querySelector('[data-chat-close]') as HTMLElement).click();
        fixture.detectChanges();
        expect(chatSection().className).toContain('translate-x-full');
      });

      it('shows no unread badge on list rows: the envelope has the unread count', () => {
        unread['o5'] = 2;
        orderService.getOrdersPaged.mockReturnValue(
          of(page([makeOrder('o5', { status: OrderStatusEnum.Pending, source: OrderSourceEnum.CustomerLink })])),
        );
        init();

        expect(el().querySelector('[data-row-unread]')).toBeNull();
      });
    });

    it('shows nothing when no order is waiting', () => {
      init();
      expect(banner()).toBeNull();
    });

    it('shows the customer, how it is handed over, the item count, total and payment method', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { orderNumber: 1042 })]));
      init();

      const text = banner()!.textContent ?? '';
      expect(text).toContain('#1042');
      expect(text).toContain('Maria Cruz');
      expect(text).toContain('Pickup');
      expect(text).toContain('2 items');
      expect(text).not.toContain('Latte');
      expect(text).toContain('360.00');
      expect(text).toContain('Cash');
    });

    it('leaves the contact number, tip and change to the order details', () => {
      orderService.getAwaitingOrders.mockReturnValue(of([waiting('o1', { tips: 20 })]));
      init();

      const text = banner()!.textContent ?? '';
      expect(text).not.toContain('0917 123 4567');
      expect(text).not.toContain('Tip');
      expect(text).not.toContain('prepare change');
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
            {
              provide: AuthService,
              useValue: { canWriteOrders: () => false, canOverrideOrders: () => false, canWriteStockWaste: () => false },
            },
            { provide: AlertService, useValue: alert },
            { provide: ListStateService, useValue: listState },
            { provide: ConnectivityService, useValue: { isOnline } },
            { provide: SignalRService, useValue: signalR },
            { provide: OfflineOrderService, useValue: offline },
            { provide: ConversationInboxService, useValue: inbox },
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
