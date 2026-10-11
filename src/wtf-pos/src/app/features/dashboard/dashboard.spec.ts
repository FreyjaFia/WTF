import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardService, SignalRService } from '@core/services';
import { DashboardDto } from '@shared/models';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internals } from '../../testing/feature-spec-helpers';
import { Dashboard } from './dashboard';

function makeDashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    today: {
      totalOrders: 12,
      totalRevenue: 1200,
      averageOrderValue: 100,
      totalTips: 60,
      totalCustomers: 10,
      yesterdayTotalOrders: 10,
      yesterdayTotalRevenue: 1000,
      yesterdayAverageOrderValue: 90,
      yesterdayTotalTips: 50,
    },
    topSellingProducts: [
      { productId: 'p1', productName: 'Latte', quantitySold: 30, revenue: 600, imageUrl: null },
      { productId: 'p2', productName: 'Mocha', quantitySold: 10, revenue: 200, imageUrl: null },
    ],
    ordersByStatus: { pending: 1, completed: 8, cancelled: 2, refunded: 1 },
    recentOrders: [
      {
        id: 'o1',
        orderNumber: 1,
        createdAt: '2026-03-02T11:59:30Z',
        totalAmount: 50,
        statusId: 2,
        statusName: 'Completed',
      },
      {
        id: 'o2',
        orderNumber: 2,
        createdAt: '2026-03-02T11:30:00Z',
        totalAmount: 25,
        statusId: 1,
        statusName: 'Pending',
      },
    ],
    hourlyRevenue: [
      { hour: 7, revenue: 5, orders: 1, tips: 0 },
      { hour: 8, revenue: 100, orders: 4, tips: 5 },
      { hour: 12, revenue: 300, orders: 6, tips: 10 },
      { hour: 15, revenue: 0, orders: 0, tips: 0 },
    ],
    paymentMethods: [
      { name: 'Cash', count: 5, total: 500 },
      { name: 'Card', count: 7, total: 700 },
    ],
    comparisonLabel: 'vs Yesterday',
    dailyRevenue: null,
    ...overrides,
  };
}

describe('Dashboard', () => {
  let service: { getDashboard: ReturnType<typeof vi.fn> };
  let hub$: Subject<void>;
  let signalR: {
    startDashboardHub: ReturnType<typeof vi.fn>;
    stopDashboardHub: ReturnType<typeof vi.fn>;
    dashboardUpdated: Observable<void>;
  };

  function create(detect = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: service },
        { provide: SignalRService, useValue: signalR },
      ],
    });
    const fixture = TestBed.createComponent(Dashboard);
    if (detect) {
      fixture.detectChanges();
    }
    return { fixture, vm: internals(fixture.componentInstance) };
  }

  beforeEach(() => {
    service = { getDashboard: vi.fn(() => of(makeDashboard())) };
    hub$ = new Subject<void>();
    signalR = {
      startDashboardHub: vi.fn(),
      stopDashboardHub: vi.fn(),
      dashboardUpdated: hub$.asObservable(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loading', () => {
    it('loads the dashboard for the default "today" range and starts the hub', () => {
      const { vm } = create();
      expect(service.getDashboard).toHaveBeenCalledWith({ preset: 'today' });
      expect(signalR.startDashboardHub).toHaveBeenCalledTimes(1);
      expect(vm['dashboard']()).not.toBeNull();
      expect(vm['isLoading']()).toBe(false);
      expect(vm['errorMessage']()).toBeNull();
    });

    it('is in loading state until the first response arrives', () => {
      const pending = new Subject<DashboardDto>();
      service.getDashboard.mockReturnValue(pending);
      const { fixture, vm } = create();
      expect(vm['isLoading']()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).not.toBeNull();
      pending.next(makeDashboard());
      fixture.detectChanges();
      expect(vm['isLoading']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).toBeNull();
    });

    it('stores the error message and shows it when loading fails', () => {
      service.getDashboard.mockReturnValue(throwError(() => new Error('Server down')));
      const { fixture, vm } = create();
      expect(vm['errorMessage']()).toBe('Server down');
      expect(vm['isLoading']()).toBe(false);
      expect(vm['dashboard']()).toBeNull();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Server down');
    });

    it('renders KPI values and top products from the response', () => {
      const { fixture } = create();
      const text = (fixture.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('Latte');
      expect(text).toContain('Mocha');
    });

    it('stops the hub and unsubscribes on destroy', () => {
      const { fixture } = create();
      fixture.destroy();
      expect(signalR.stopDashboardHub).toHaveBeenCalledTimes(1);
      service.getDashboard.mockClear();
      hub$.next();
      expect(service.getDashboard).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('refreshDashboard reloads without the full-page spinner when data already exists', () => {
      const { vm } = create();
      const pending = new Subject<DashboardDto>();
      service.getDashboard.mockReturnValue(pending);
      vm['refreshDashboard']();
      expect(vm['isRefreshing']()).toBe(true);
      expect(vm['isLoading']()).toBe(false);
      pending.next(makeDashboard());
      expect(vm['isRefreshing']()).toBe(false);
    });

    it('refreshDashboard shows the spinner when nothing has loaded yet', () => {
      service.getDashboard.mockReturnValueOnce(throwError(() => new Error('x')));
      const { vm } = create();
      service.getDashboard.mockReturnValue(new Subject<DashboardDto>());
      vm['refreshDashboard']();
      expect(vm['isLoading']()).toBe(true);
      expect(vm['errorMessage']()).toBeNull();
    });

    it('a failed refresh clears the refreshing flag and reports the error', () => {
      const { vm } = create();
      service.getDashboard.mockReturnValue(throwError(() => new Error('nope')));
      vm['refreshDashboard']();
      expect(vm['isRefreshing']()).toBe(false);
      expect(vm['errorMessage']()).toBe('nope');
    });

    it('hub updates refresh silently, replacing data and clearing a previous error', () => {
      service.getDashboard.mockReturnValueOnce(throwError(() => new Error('first fail')));
      const { vm } = create();
      expect(vm['errorMessage']()).toBe('first fail');
      const fresh = makeDashboard({ comparisonLabel: 'vs Last Week' });
      service.getDashboard.mockReturnValue(of(fresh));
      hub$.next();
      expect(vm['dashboard']()).toBe(fresh);
      expect(vm['errorMessage']()).toBeNull();
      expect(vm['isLoading']()).toBe(false);
    });

    it('hub update errors are swallowed and keep stale data', () => {
      const { vm } = create();
      const stale = vm['dashboard']();
      service.getDashboard.mockReturnValue(throwError(() => new Error('flaky')));
      hub$.next();
      expect(vm['dashboard']()).toBe(stale);
      expect(vm['errorMessage']()).toBeNull();
    });
  });

  describe('date range', () => {
    it('onDateRangeChanged stores the range and reloads with it', () => {
      const { vm } = create();
      vm['isRefreshing'].set(true);
      vm['onDateRangeChanged']({ preset: 'last7days' });
      expect(vm['currentRange']()).toEqual({ preset: 'last7days' });
      expect(service.getDashboard).toHaveBeenLastCalledWith({ preset: 'last7days' });
      expect(vm['isRefreshing']()).toBe(false);
    });

    it('silent hub refresh uses the current range', () => {
      const { vm } = create();
      vm['onDateRangeChanged']({ preset: 'yesterday' });
      hub$.next();
      expect(service.getDashboard).toHaveBeenLastCalledWith({ preset: 'yesterday' });
    });

    it('openFilters seeds the mobile state from the current range', () => {
      const { vm } = create();
      vm['onDateRangeChanged']({ preset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' });
      vm['openFilters']();
      expect(vm['isFiltersOpen']()).toBe(true);
      expect(vm['mobilePreset']()).toBe('custom');
      expect(vm['mobileCustomStartDate']()).toBe('2026-01-01');
      expect(vm['mobileCustomEndDate']()).toBe('2026-01-31');
      vm['closeFilters']();
      expect(vm['isFiltersOpen']()).toBe(false);
    });

    it('openFilters resets the custom dates for a preset range', () => {
      const { vm } = create();
      vm['mobileCustomStartDate'].set('stale');
      vm['openFilters']();
      expect(vm['mobilePreset']()).toBe('today');
      expect(vm['mobileCustomStartDate']()).toBe('');
      expect(vm['mobileCustomEndDate']()).toBe('');
    });

    it('selecting a non-custom mobile preset applies it immediately and clears custom dates', () => {
      const { vm } = create();
      vm['mobileCustomStartDate'].set('2026-01-01');
      vm['selectMobilePreset']('last30days');
      expect(vm['mobilePreset']()).toBe('last30days');
      expect(vm['mobileCustomStartDate']()).toBe('');
      expect(service.getDashboard).toHaveBeenLastCalledWith({ preset: 'last30days' });
    });

    it('selecting the custom mobile preset does not reload', () => {
      const { vm } = create();
      service.getDashboard.mockClear();
      vm['selectMobilePreset']('custom');
      expect(vm['mobilePreset']()).toBe('custom');
      expect(service.getDashboard).not.toHaveBeenCalled();
    });

    it('applyMobileRange with custom needs both dates', () => {
      const { vm } = create();
      service.getDashboard.mockClear();
      vm['isFiltersOpen'].set(true);
      vm['mobilePreset'].set('custom');
      vm['mobileCustomStartDate'].set('2026-01-01');
      vm['applyMobileRange']();
      expect(service.getDashboard).not.toHaveBeenCalled();
      expect(vm['isFiltersOpen']()).toBe(true);
    });

    it('applyMobileRange with custom dates reloads and closes the drawer', () => {
      const { vm } = create();
      vm['isFiltersOpen'].set(true);
      vm['mobilePreset'].set('custom');
      vm['mobileCustomStartDate'].set('2026-01-01');
      vm['mobileCustomEndDate'].set('2026-01-31');
      vm['applyMobileRange']();
      expect(service.getDashboard).toHaveBeenLastCalledWith({
        preset: 'custom',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      expect(vm['isFiltersOpen']()).toBe(false);
    });

    it('applyMobileRange with a preset reloads and closes the drawer', () => {
      const { vm } = create();
      vm['isFiltersOpen'].set(true);
      vm['mobilePreset'].set('yesterday');
      vm['applyMobileRange']();
      expect(service.getDashboard).toHaveBeenLastCalledWith({ preset: 'yesterday' });
      expect(vm['isFiltersOpen']()).toBe(false);
    });

    it('clearMobileCustomDates empties both dates', () => {
      const { vm } = create();
      vm['mobileCustomStartDate'].set('a');
      vm['mobileCustomEndDate'].set('b');
      vm['clearMobileCustomDates']();
      expect(vm['mobileCustomStartDate']()).toBe('');
      expect(vm['mobileCustomEndDate']()).toBe('');
    });
  });

  describe('derived data', () => {
    it('computes percent changes against yesterday', () => {
      const { vm } = create();
      expect(vm['revenueChangePercent']()).toBe(20);
      expect(vm['ordersChangePercent']()).toBe(20);
      expect(vm['tipsChangePercent']()).toBe(20);
      expect(vm['avgOrderChangeDelta']()).toBe(10);
    });

    it('treats a zero baseline as +100% when there is activity and 0% otherwise', () => {
      const base = makeDashboard();
      service.getDashboard.mockReturnValue(
        of(
          makeDashboard({
            today: { ...base.today, yesterdayTotalRevenue: 0, yesterdayTotalOrders: 0, totalOrders: 0 },
          }),
        ),
      );
      const { vm } = create();
      expect(vm['revenueChangePercent']()).toBe(100);
      expect(vm['ordersChangePercent']()).toBe(0);
    });

    it('rounds negative percent changes', () => {
      const base = makeDashboard();
      service.getDashboard.mockReturnValue(
        of(makeDashboard({ today: { ...base.today, totalRevenue: 700, yesterdayTotalRevenue: 900 } })),
      );
      const { vm } = create();
      expect(vm['revenueChangePercent']()).toBe(-22);
    });

    it('uses hourly series from 8am for single-day ranges', () => {
      const { vm } = create();
      expect(vm['isMultiDay']()).toBe(false);
      expect(vm['chartTitle']()).toBe('Sales by Hour');
      expect(vm['salesByHour']()).toEqual([
        { label: '8am', value: 100 },
        { label: '12pm', value: 300 },
        { label: '3pm', value: 0 },
      ]);
      expect(vm['ordersByPeriod']()).toEqual([
        { label: '8am', value: 4 },
        { label: '12pm', value: 6 },
        { label: '3pm', value: 0 },
      ]);
      expect(vm['revenueSparkline']()).toEqual([5, 100, 300, 0]);
      expect(vm['ordersSparkline']()).toEqual([1, 4, 6, 0]);
      expect(vm['tipsSparkline']()).toEqual([0, 5, 10, 0]);
      expect(vm['avgOrderSparkline']()).toEqual([5, 25, 50, 0]);
    });

    it('uses daily series with weekday labels for short multi-day ranges', () => {
      service.getDashboard.mockReturnValue(
        of(
          makeDashboard({
            dailyRevenue: [
              { date: '2026-03-02T12:00:00Z', revenue: 100, orders: 4, tips: 8 },
              { date: '2026-03-03T12:00:00Z', revenue: 0, orders: 0, tips: 0 },
            ],
          }),
        ),
      );
      const { vm } = create();
      expect(vm['isMultiDay']()).toBe(true);
      expect(vm['chartTitle']()).toBe('Sales by Day');
      expect(vm['salesByHour']()).toEqual([
        { label: 'Mon', value: 100 },
        { label: 'Tue', value: 0 },
      ]);
      expect(vm['ordersByPeriod']()).toEqual([
        { label: 'Mon', value: 4 },
        { label: 'Tue', value: 0 },
      ]);
      expect(vm['revenueSparkline']()).toEqual([100, 0]);
      expect(vm['ordersSparkline']()).toEqual([4, 0]);
      expect(vm['tipsSparkline']()).toEqual([8, 0]);
      expect(vm['avgOrderSparkline']()).toEqual([25, 0]);
    });

    it('uses month/day labels once the range exceeds 10 days', () => {
      const daily = Array.from({ length: 11 }, (_, i) => ({
        date: `2026-03-${String(i + 2).padStart(2, '0')}T12:00:00Z`,
        revenue: i,
        orders: i,
        tips: 0,
      }));
      service.getDashboard.mockReturnValue(of(makeDashboard({ dailyRevenue: daily })));
      const { vm } = create();
      const labels = vm['salesByHour']().map((p: { label: string }) => p.label);
      expect(labels[0]).toBe('Mar 2');
      expect(labels[10]).toBe('Mar 12');
    });

    it('falls back to hourly data when dailyRevenue is empty', () => {
      service.getDashboard.mockReturnValue(of(makeDashboard({ dailyRevenue: [] })));
      const { vm } = create();
      expect(vm['isMultiDay']()).toBe(false);
      expect(vm['salesByHour']()).toHaveLength(3);
    });

    it('returns empty series before data loads', () => {
      service.getDashboard.mockReturnValue(new Subject<DashboardDto>());
      const { vm } = create();
      expect(vm['salesByHour']()).toEqual([]);
      expect(vm['ordersByPeriod']()).toEqual([]);
      expect(vm['revenueSparkline']()).toEqual([]);
      expect(vm['avgOrderSparkline']()).toEqual([]);
      expect(vm['paymentDonutSegments']()).toEqual([]);
      expect(vm['statusTotal']()).toBe(0);
      expect(vm['comparisonLabel']()).toBe('vs Yesterday');
    });

    it('exposes the server comparison label', () => {
      service.getDashboard.mockReturnValue(of(makeDashboard({ comparisonLabel: 'vs Prior 7 Days' })));
      const { vm } = create();
      expect(vm['comparisonLabel']()).toBe('vs Prior 7 Days');
    });

    it('builds payment donut segments with cycling colours', () => {
      const methods = Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, count: i, total: i * 10 }));
      service.getDashboard.mockReturnValue(of(makeDashboard({ paymentMethods: methods })));
      const { vm } = create();
      const segments = vm['paymentDonutSegments']();
      expect(segments).toHaveLength(7);
      expect(segments[0]).toEqual({ label: 'M0', value: 0, color: '#047857' });
      expect(segments[6].color).toBe(segments[0].color);
    });

    it('returns no donut segments when there are no payment methods', () => {
      service.getDashboard.mockReturnValue(of(makeDashboard({ paymentMethods: [] })));
      const { vm } = create();
      expect(vm['paymentDonutSegments']()).toEqual([]);
    });

    it('computes top product totals and shares', () => {
      const { vm } = create();
      expect(vm['topProductTotalRevenue']()).toBe(800);
      expect(vm['topProductTotalQuantity']()).toBe(40);
      expect(vm['productRevenuePercent'](600)).toBe(75);
      expect(vm['productQuantityPercent'](10)).toBe(25);
    });

    it('shares are 0 when there are no top products', () => {
      service.getDashboard.mockReturnValue(of(makeDashboard({ topSellingProducts: [] })));
      const { vm } = create();
      expect(vm['topProductTotalRevenue']()).toBe(0);
      expect(vm['topProductTotalQuantity']()).toBe(0);
      expect(vm['productRevenuePercent'](10)).toBe(0);
      expect(vm['productQuantityPercent'](10)).toBe(0);
    });

    it('computes status totals and percentages', () => {
      const { vm } = create();
      expect(vm['statusTotal']()).toBe(12);
      expect(vm['statusPercent'](6)).toBe(50);
    });

    it('statusPercent is 0 when no orders exist', () => {
      const zero = { pending: 0, completed: 0, cancelled: 0, refunded: 0 };
      service.getDashboard.mockReturnValue(of(makeDashboard({ ordersByStatus: zero })));
      const { vm } = create();
      expect(vm['statusPercent'](0)).toBe(0);
    });

    it.each([
      [1, 'warning'],
      [2, 'success'],
      [3, 'default'],
      [4, 'error'],
      [99, 'info'],
    ])('maps status %i to the %s badge variant', (id, variant) => {
      const { vm } = create();
      expect(vm['getStatusVariant'](id)).toBe(variant);
    });
  });

  describe('relative timestamps', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));
    });

    it('labels recent orders by age', () => {
      const dto = makeDashboard({
        recentOrders: [
          { id: 'a', orderNumber: 1, createdAt: '2026-03-02T11:59:30Z', totalAmount: 1, statusId: 2, statusName: 'x' },
          { id: 'b', orderNumber: 2, createdAt: '2026-03-02T11:30:00Z', totalAmount: 1, statusId: 2, statusName: 'x' },
          { id: 'c', orderNumber: 3, createdAt: '2026-03-02T07:00:00Z', totalAmount: 1, statusId: 2, statusName: 'x' },
          { id: 'd', orderNumber: 4, createdAt: '2026-02-28T12:00:00Z', totalAmount: 1, statusId: 2, statusName: 'x' },
        ],
      });
      service.getDashboard.mockReturnValue(of(dto));
      const { vm } = create();
      expect(vm['orderTimeAgos']()).toEqual({ a: 'just now', b: '30m ago', c: '5h ago', d: '2d ago' });
    });

    it('refreshes labels every 30 seconds', () => {
      const dto = makeDashboard({
        recentOrders: [
          { id: 'a', orderNumber: 1, createdAt: '2026-03-02T11:59:30Z', totalAmount: 1, statusId: 2, statusName: 'x' },
        ],
      });
      service.getDashboard.mockReturnValue(of(dto));
      const { vm } = create();
      expect(vm['orderTimeAgos']()['a']).toBe('just now');
      vi.advanceTimersByTime(60_000);
      expect(vm['orderTimeAgos']()['a']).toBe('1m ago');
    });

    it('stops the timer on destroy', () => {
      const { fixture, vm } = create();
      fixture.destroy();
      vm['orderTimeAgos'].set({ keep: 'me' });
      vi.advanceTimersByTime(120_000);
      expect(vm['orderTimeAgos']()).toEqual({ keep: 'me' });
    });
  });
});
