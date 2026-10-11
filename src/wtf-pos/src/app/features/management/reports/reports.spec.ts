import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertService, FileDownloadService, ReportsService, UserService } from '@core/services';
import {
  DailySalesReportRowDto,
  HourlySalesReportRowDto,
  MonthlyReportWorkbookStatusDto,
  PaymentsReportRowDto,
  ProductSalesReportRowDto,
  ReportType,
  StaffPerformanceReportRowDto,
} from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsComponent } from './reports';

interface Reports {
  dailyReports: { set: (v: DailySalesReportRowDto[]) => void };
  productReports: { set: (v: ProductSalesReportRowDto[]) => void };
  paymentsReports: { set: (v: PaymentsReportRowDto[]) => void };
  hourlyReports: { set: (v: HourlySalesReportRowDto[]) => void };
  staffReports: { set: (v: StaffPerformanceReportRowDto[]) => void };
  isLoading: () => boolean;
  isRefreshing: () => boolean;
  isDownloadingExcel: () => boolean;
  isDownloadingPdf: () => boolean;
  isGeneratingMonthlyWorkbook: () => boolean;
  isDownloadingMonthlyWorkbook: () => boolean;
  searchTerm: () => string;
  isFiltersOpen: () => boolean;
  staffOptions: () => { id: string; name: string }[];
  monthlyWorkbookStatus: () => MonthlyReportWorkbookStatusDto | null;
  activeTab: () => string;
  selectedReportType: () => ReportType;
  reportForm: {
    controls: Record<string, { value: unknown; setValue: (v: unknown) => void }>;
    patchValue: (v: object) => void;
    getRawValue: () => Record<string, unknown>;
  };
  filteredDailyReports: () => DailySalesReportRowDto[];
  filteredProductReports: () => ProductSalesReportRowDto[];
  filteredPaymentsReports: () => PaymentsReportRowDto[];
  filteredHourlyReports: () => HourlySalesReportRowDto[];
  filteredStaffReports: () => StaffPerformanceReportRowDto[];
  openFilters: () => void;
  closeFilters: () => void;
  selectTab: (t: string) => void;
  isReportsTabActive: () => boolean;
  isMonthlyWorkbookTabActive: () => boolean;
  onPresetChanged: (e: Event) => void;
  onReportTypeChanged: () => void;
  onGroupByChanged: () => void;
  onDateChanged: () => void;
  onAdvancedFilterChanged: () => void;
  onSearchChanged: (e: Event) => void;
  refresh: () => void;
  toggleDailySort: (c: string) => void;
  toggleProductSort: (c: string) => void;
  togglePaymentsSort: (c: string) => void;
  toggleHourlySort: (c: string) => void;
  toggleStaffSort: (c: string) => void;
  isSorted: (c: string) => boolean;
  getSortDirection: (c: string) => string;
  downloadExcel: () => void;
  downloadPdf: () => void;
  onMonthlyWorkbookFilterChanged: () => void;
  generateMonthlyWorkbook: () => void;
  downloadMonthlyWorkbook: () => void;
  canDownloadMonthlyWorkbook: () => boolean;
  isReportExportBusy: () => boolean;
  isMonthlyWorkbookDownloadDisabled: () => boolean;
  getMonthlyWorkbookStatusText: () => string;
  getReportTypeLabel: (t: ReportType) => string;
  showGroupByFilter: () => boolean;
  showProductFilters: () => boolean;
  showStaffFilter: () => boolean;
  isDailySalesReport: () => boolean;
  isProductSalesReport: () => boolean;
  isPaymentsReport: () => boolean;
  isHourlyReport: () => boolean;
  isStaffReport: () => boolean;
  getDailyTotals: () => DailySalesReportRowDto;
  getProductTotals: () => { quantitySold: number; revenue: number };
  getPaymentsTotals: () => { orderCount: number; totalAmount: number };
  getHourlyTotals: () => { orderCount: number; revenue: number };
  getStaffTotals: () => {
    orderCount: number;
    revenue: number;
    averageOrderValue: number;
    tipsReceived: number;
  };
  toHourLabel: (h: number) => string;
  getDailyPeriodHeaderLabel: () => string;
  getDailyPeriodLabel: (s: string) => string;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const daily: DailySalesReportRowDto[] = [
  { periodStart: '2026-03-01', totalRevenue: 100, orderCount: 2, averageOrderValue: 50, tipsTotal: 5, voidCancelledCount: 1 },
  { periodStart: '2026-03-02', totalRevenue: 300, orderCount: 3, averageOrderValue: 100, tipsTotal: 0, voidCancelledCount: 0 },
];
const products: ProductSalesReportRowDto[] = [
  { productId: 'a', productName: 'Latte', categoryName: 'Drink', subCategoryName: 'Coffee', quantitySold: 5, revenue: 500, revenuePercent: 50 },
  { productId: 'b', productName: 'Chips', categoryName: 'Food', subCategoryName: null, quantitySold: 10, revenue: 500, revenuePercent: 50 },
];
const payments: PaymentsReportRowDto[] = [
  { paymentMethod: 'Cash', orderCount: 3, totalAmount: 300, totalPercent: 75 },
  { paymentMethod: 'GCash', orderCount: 1, totalAmount: 100, totalPercent: 25 },
];
const hourly: HourlySalesReportRowDto[] = [
  { hour: 0, orderCount: 1, revenue: 10 },
  { hour: 9, orderCount: 2, revenue: 20 },
  { hour: 12, orderCount: 3, revenue: 30 },
  { hour: 15, orderCount: 4, revenue: 40 },
];
const staff: StaffPerformanceReportRowDto[] = [
  { staffId: 's1', staffName: 'Ann', orderCount: 2, totalRevenue: 200, averageOrderValue: 100, tipsReceived: 4 },
  { staffId: 's2', staffName: 'Bob', orderCount: 3, totalRevenue: 300, averageOrderValue: 100, tipsReceived: 6 },
];

describe('ReportsComponent', () => {
  let fixture: ComponentFixture<ReportsComponent>;
  let t: Reports;
  let reports: Record<string, ReturnType<typeof vi.fn>>;
  let fileDownload: { saveBlob: ReturnType<typeof vi.fn> };
  let alert: Record<string, ReturnType<typeof vi.fn>>;
  let users: { getUsers: ReturnType<typeof vi.fn> };
  const blob = new Blob(['x']);
  const status = (over: Partial<MonthlyReportWorkbookStatusDto> = {}): MonthlyReportWorkbookStatusDto => ({
    year: 2026,
    month: 3,
    exists: true,
    fileName: 'WB.xlsx',
    generatedAtUtc: null,
    ...over,
  });

  const create = async () => {
    fixture = TestBed.createComponent(ReportsComponent);
    t = fixture.componentInstance as unknown as Reports;
    fixture.detectChanges();
    await settle();
  };

  const fieldValue = (name: string) => t.reportForm.controls[name].value;
  const setField = (name: string, v: unknown) => t.reportForm.controls[name].setValue(v);
  const input = (value: string): Event => {
    const el = document.createElement('input');
    el.value = value;
    const ev = new Event('input');
    Object.defineProperty(ev, 'target', { value: el });
    return ev;
  };

  beforeEach(() => {
    // Sunday 15 March 2026, local time.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));
    reports = {
      getDailySalesReport: vi.fn().mockReturnValue(of(daily)),
      getProductSalesReport: vi.fn().mockReturnValue(of(products)),
      getPaymentsReport: vi.fn().mockReturnValue(of(payments)),
      getHourlySalesReport: vi.fn().mockReturnValue(of(hourly)),
      getStaffPerformanceReport: vi.fn().mockReturnValue(of(staff)),
      downloadDailySalesExcel: vi.fn().mockReturnValue(of(blob)),
      downloadProductSalesExcel: vi.fn().mockReturnValue(of(blob)),
      downloadPaymentsExcel: vi.fn().mockReturnValue(of(blob)),
      downloadHourlySalesExcel: vi.fn().mockReturnValue(of(blob)),
      downloadStaffPerformanceExcel: vi.fn().mockReturnValue(of(blob)),
      downloadDailySalesPdf: vi.fn().mockReturnValue(of(blob)),
      downloadProductSalesPdf: vi.fn().mockReturnValue(of(blob)),
      downloadPaymentsPdf: vi.fn().mockReturnValue(of(blob)),
      downloadHourlySalesPdf: vi.fn().mockReturnValue(of(blob)),
      downloadStaffPerformancePdf: vi.fn().mockReturnValue(of(blob)),
      getMonthlyWorkbookStatus: vi.fn().mockReturnValue(of(status())),
      generateMonthlyWorkbook: vi.fn().mockReturnValue(of(status({ fileName: 'Gen.xlsx' }))),
      downloadMonthlyWorkbook: vi.fn().mockReturnValue(of(blob)),
    };
    fileDownload = { saveBlob: vi.fn().mockResolvedValue(undefined) };
    alert = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    users = {
      getUsers: vi.fn().mockReturnValue(
        of([
          { id: 'u2', firstName: 'Zed', lastName: 'Z', username: 'zz' },
          { id: 'u1', firstName: 'Amy', lastName: 'A', username: 'aa' },
          { id: 'u3', firstName: '', lastName: '', username: 'noname' },
        ]),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ReportsService, useValue: reports },
        { provide: FileDownloadService, useValue: fileDownload },
        { provide: AlertService, useValue: alert },
        { provide: UserService, useValue: users },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialisation', () => {
    it('defaults to this month, loads daily report, staff options and workbook status', async () => {
      await create();
      expect(fieldValue('preset')).toBe('this-month');
      expect(fieldValue('fromDate')).toBe('2026-03-01');
      expect(fieldValue('toDate')).toBe('2026-03-15');
      expect(fieldValue('workbookYear')).toBe(2026);
      expect(fieldValue('workbookMonth')).toBe(3);
      expect(reports['getDailySalesReport']).toHaveBeenCalledWith({
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
        groupBy: 'Day',
      });
      expect(t.filteredDailyReports().length).toBe(2);
      expect(t.isLoading()).toBe(false);
      expect(users.getUsers).toHaveBeenCalledWith({ isActive: true });
      expect(t.staffOptions().map((s) => s.name)).toEqual(['Amy A (aa)', 'noname', 'Zed Z (zz)']);
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledWith(2026, 3);
      expect(t.monthlyWorkbookStatus()?.fileName).toBe('WB.xlsx');
      expect(t.isDailySalesReport()).toBe(true);
    });

    it('survives staff and workbook status load failures', async () => {
      users.getUsers.mockReturnValue(throwError(() => new Error('x')));
      reports['getMonthlyWorkbookStatus'].mockReturnValue(throwError(() => new Error('x')));
      await create();
      expect(t.staffOptions()).toEqual([]);
      expect(t.monthlyWorkbookStatus()).toBeNull();
    });

    it('renders the report table and the workbook tab', async () => {
      await create();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toBeTruthy();
      t.selectTab('monthly-workbook');
      fixture.detectChanges();
      expect(t.isMonthlyWorkbookTabActive()).toBe(true);
      expect(t.isReportsTabActive()).toBe(false);
    });
  });

  describe('date presets and range handling', () => {
    const choose = (value: string) => {
      const select = document.createElement('select');
      select.add(new Option(value, value));
      select.value = value;
      const ev = new Event('change');
      Object.defineProperty(ev, 'target', { value: select });
      return ev;
    };

    it.each([
      ['today', '2026-03-15', '2026-03-15'],
      ['yesterday', '2026-03-14', '2026-03-14'],
      ['this-week', '2026-03-09', '2026-03-15'],
      ['this-month', '2026-03-01', '2026-03-15'],
      ['last-month', '2026-02-01', '2026-02-28'],
    ])('applies %s preset and reloads', async (preset, from, to) => {
      await create();
      reports['getDailySalesReport'].mockClear();
      t.onPresetChanged(choose(preset));
      expect(fieldValue('preset')).toBe(preset);
      expect(fieldValue('fromDate')).toBe(from);
      expect(fieldValue('toDate')).toBe(to);
      expect(reports['getDailySalesReport']).toHaveBeenCalledWith({
        fromDate: from,
        toDate: to,
        groupBy: 'Day',
      });
    });

    it('custom preset keeps the dates', async () => {
      await create();
      t.onPresetChanged(choose('custom'));
      expect(fieldValue('fromDate')).toBe('2026-03-01');
    });

    it('changing a date switches the preset to custom and reloads', async () => {
      await create();
      reports['getDailySalesReport'].mockClear();
      setField('fromDate', '2026-03-05');
      t.onDateChanged();
      expect(fieldValue('preset')).toBe('custom');
      expect(reports['getDailySalesReport']).toHaveBeenCalledWith(
        expect.objectContaining({ fromDate: '2026-03-05' }),
      );
    });

    it('rejects reversed ranges', async () => {
      await create();
      reports['getDailySalesReport'].mockClear();
      setField('fromDate', '2026-03-20');
      t.onDateChanged();
      expect(alert['error']).toHaveBeenCalledWith('From date must be earlier than or equal to To date.');
      expect(reports['getDailySalesReport']).not.toHaveBeenCalled();
      expect(t.isLoading()).toBe(false);
    });

    it('rejects missing dates', async () => {
      await create();
      setField('toDate', '');
      t.onDateChanged();
      expect(alert['error']).toHaveBeenCalledWith('Please select report filters first.');
    });

    it('accepts equal from/to dates', async () => {
      await create();
      reports['getDailySalesReport'].mockClear();
      setField('fromDate', '2026-03-15');
      t.onDateChanged();
      expect(reports['getDailySalesReport']).toHaveBeenCalled();
    });
  });

  describe('report types', () => {
    it('daily group by changes reload and header/period labels', async () => {
      await create();
      expect(t.showGroupByFilter()).toBe(true);
      expect(t.getDailyPeriodHeaderLabel()).toBe('Date');
      expect(t.getDailyPeriodLabel('2026-03-02T00:00:00')).toContain('March 2, 2026');
      expect(t.getDailyPeriodLabel('garbage')).toBe('garbage');

      setField('groupBy', 'Week');
      reports['getDailySalesReport'].mockClear();
      t.onGroupByChanged();
      expect(reports['getDailySalesReport']).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'Week' }),
      );
      expect(t.getDailyPeriodHeaderLabel()).toBe('Week');
      expect(t.getDailyPeriodLabel('2026-03-02T00:00:00')).toContain(' - ');
      expect(t.getDailyPeriodLabel('2026-03-02T00:00:00')).toContain('March 8, 2026');

      setField('groupBy', 'Month');
      expect(t.getDailyPeriodHeaderLabel()).toBe('Month');
      expect(t.getDailyPeriodLabel('2026-03-02T00:00:00')).toBe('March 2026');
    });

    it('missing group by blocks the daily report', async () => {
      await create();
      setField('groupBy', null);
      reports['getDailySalesReport'].mockClear();
      t.onGroupByChanged();
      expect(alert['error']).toHaveBeenCalledWith('Group by is required for Daily Sales report.');
      expect(reports['getDailySalesReport']).not.toHaveBeenCalled();
    });

    it.each([
      ['product-sales', 'getProductSalesReport', 'isProductSalesReport'],
      ['payments', 'getPaymentsReport', 'isPaymentsReport'],
      ['hourly', 'getHourlySalesReport', 'isHourlyReport'],
      ['staff', 'getStaffPerformanceReport', 'isStaffReport'],
    ] as const)('switching to %s loads via %s and clears search', async (type, method, predicate) => {
      await create();
      t.onSearchChanged(input('abc'));
      expect(t.searchTerm()).toBe('abc');
      setField('reportType', type);
      t.onReportTypeChanged();
      expect(t.searchTerm()).toBe('');
      expect(reports[method]).toHaveBeenCalledWith({ fromDate: '2026-03-01', toDate: '2026-03-15' });
      expect(t[predicate]()).toBe(true);
      expect(t.selectedReportType()).toBe(type);
    });

    it('product filters are included only when set', async () => {
      await create();
      setField('reportType', 'product-sales');
      t.onReportTypeChanged();
      expect(t.showProductFilters()).toBe(true);
      setField('categoryId', 1);
      setField('subCategoryId', 3);
      t.onAdvancedFilterChanged();
      expect(reports['getProductSalesReport']).toHaveBeenLastCalledWith({
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
        categoryId: 1,
        subCategoryId: 3,
      });
    });

    it('staff filter trims id and ignores blank', async () => {
      await create();
      setField('reportType', 'staff');
      t.onReportTypeChanged();
      expect(t.showStaffFilter()).toBe(true);
      setField('staffId', ' s1 ');
      t.onAdvancedFilterChanged();
      expect(reports['getStaffPerformanceReport']).toHaveBeenLastCalledWith({
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
        staffId: 's1',
      });
      setField('staffId', '   ');
      t.onAdvancedFilterChanged();
      expect(reports['getStaffPerformanceReport']).toHaveBeenLastCalledWith({
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
      });
    });

    it.each([
      ['daily-sales', 'getDailySalesReport', 'dailySales'],
      ['product-sales', 'getProductSalesReport', 'productSales'],
      ['payments', 'getPaymentsReport', 'payments'],
      ['hourly', 'getHourlySalesReport', 'hourly'],
      ['staff', 'getStaffPerformanceReport', 'staff'],
    ])('%s load error alerts and clears rows', async (type, method, key) => {
      await create();
      setField('reportType', type);
      t.onReportTypeChanged();
      const rows = {
        dailySales: () => t.filteredDailyReports(),
        productSales: () => t.filteredProductReports(),
        payments: () => t.filteredPaymentsReports(),
        hourly: () => t.filteredHourlyReports(),
        staff: () => t.filteredStaffReports(),
      }[key as 'dailySales' | 'productSales' | 'payments' | 'hourly' | 'staff'];
      expect(rows().length).toBeGreaterThan(0);

      reports[method].mockReturnValue(throwError(() => new Error('load failed')));
      t.onReportTypeChanged();
      expect(alert['error']).toHaveBeenCalledWith('load failed');
      expect(t.isLoading()).toBe(false);
      expect(rows()).toEqual([]);
    });

    it('type labels', async () => {
      await create();
      expect(t.getReportTypeLabel('daily-sales')).toBe('Daily Sales Summary');
      expect(t.getReportTypeLabel('product-sales')).toBe('Product Sales Breakdown');
      expect(t.getReportTypeLabel('payments')).toBe('Payment Method Breakdown');
      expect(t.getReportTypeLabel('hourly')).toBe('Hourly Sales Distribution');
      expect(t.getReportTypeLabel('staff')).toBe('Staff Performance');
    });

    it('refresh reloads report and workbook status then clears refreshing', async () => {
      await create();
      reports['getDailySalesReport'].mockClear();
      reports['getMonthlyWorkbookStatus'].mockClear();
      t.refresh();
      expect(reports['getDailySalesReport']).toHaveBeenCalledTimes(1);
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledTimes(1);
      expect(t.isRefreshing()).toBe(false);
    });

    it('refreshing flag is cleared even when the range is invalid', async () => {
      await create();
      setField('fromDate', '');
      t.refresh();
      expect(t.isRefreshing()).toBe(false);
    });
  });

  describe('search, sorting and totals', () => {
    it('filters and sorts daily rows', async () => {
      await create();
      expect(t.filteredDailyReports().map((r) => r.periodStart)).toEqual(['2026-03-02', '2026-03-01']);
      t.toggleDailySort('periodStart');
      expect(t.filteredDailyReports().map((r) => r.periodStart)).toEqual(['2026-03-01', '2026-03-02']);
      t.toggleDailySort('totalRevenue');
      expect(t.getSortDirection('totalRevenue')).toBe('asc');
      expect(t.filteredDailyReports().map((r) => r.totalRevenue)).toEqual([100, 300]);
      t.toggleDailySort('totalRevenue');
      expect(t.filteredDailyReports().map((r) => r.totalRevenue)).toEqual([300, 100]);
      expect(t.isSorted('totalRevenue')).toBe(true);
      expect(t.isSorted('orderCount')).toBe(false);
      expect(t.getSortDirection('orderCount')).toBe('asc');

      t.onSearchChanged(input('300'));
      expect(t.filteredDailyReports().length).toBe(1);
      t.onSearchChanged(input('  '));
      expect(t.filteredDailyReports().length).toBe(2);
    });

    it('daily totals', async () => {
      await create();
      expect(t.getDailyTotals()).toEqual({
        periodStart: 'TOTAL',
        totalRevenue: 400,
        orderCount: 5,
        averageOrderValue: 80,
        tipsTotal: 5,
        voidCancelledCount: 1,
      });
      t.onSearchChanged(input('zzz'));
      expect(t.getDailyTotals().averageOrderValue).toBe(0);
    });

    it('product rows: sort by text, search by sub category, totals', async () => {
      await create();
      setField('reportType', 'product-sales');
      t.onReportTypeChanged();
      t.toggleProductSort('productName');
      expect(t.filteredProductReports().map((r) => r.productName)).toEqual(['Chips', 'Latte']);
      t.toggleProductSort('productName');
      expect(t.filteredProductReports().map((r) => r.productName)).toEqual(['Latte', 'Chips']);
      expect(t.isSorted('productName')).toBe(true);
      expect(t.getSortDirection('productName')).toBe('desc');
      t.onSearchChanged(input('coffee'));
      expect(t.filteredProductReports().map((r) => r.productId)).toEqual(['a']);
      expect(t.getProductTotals()).toEqual({ quantitySold: 5, revenue: 500 });
    });

    it('payments rows', async () => {
      await create();
      setField('reportType', 'payments');
      t.onReportTypeChanged();
      expect(t.filteredPaymentsReports().map((r) => r.paymentMethod)).toEqual(['Cash', 'GCash']);
      t.togglePaymentsSort('orderCount');
      expect(t.filteredPaymentsReports().map((r) => r.orderCount)).toEqual([1, 3]);
      expect(t.isSorted('orderCount')).toBe(true);
      t.onSearchChanged(input('gcash'));
      expect(t.filteredPaymentsReports().length).toBe(1);
      expect(t.getPaymentsTotals()).toEqual({ orderCount: 1, totalAmount: 100 });
    });

    it('hourly rows, labels and totals', async () => {
      await create();
      setField('reportType', 'hourly');
      t.onReportTypeChanged();
      expect(t.filteredHourlyReports().map((r) => r.hour)).toEqual([0, 9, 12, 15]);
      t.toggleHourlySort('hour');
      expect(t.filteredHourlyReports().map((r) => r.hour)).toEqual([15, 12, 9, 0]);
      expect(t.isSorted('hour')).toBe(true);
      expect([0, 9, 12, 15].map((h) => t.toHourLabel(h))).toEqual(['12 AM', '9 AM', '12 PM', '3 PM']);
      t.onSearchChanged(input('3 pm'));
      expect(t.filteredHourlyReports().map((r) => r.hour)).toEqual([15]);
      expect(t.getHourlyTotals()).toEqual({ orderCount: 4, revenue: 40 });
    });

    it('staff rows and totals', async () => {
      await create();
      setField('reportType', 'staff');
      t.onReportTypeChanged();
      expect(t.filteredStaffReports().map((r) => r.staffName)).toEqual(['Bob', 'Ann']);
      t.toggleStaffSort('staffName');
      expect(t.filteredStaffReports().map((r) => r.staffName)).toEqual(['Ann', 'Bob']);
      expect(t.isSorted('staffName')).toBe(true);
      expect(t.getSortDirection('staffName')).toBe('asc');
      expect(t.getStaffTotals()).toEqual({
        orderCount: 5,
        revenue: 500,
        averageOrderValue: 100,
        tipsReceived: 10,
      });
      t.onSearchChanged(input('nobody'));
      expect(t.getStaffTotals().averageOrderValue).toBe(0);
    });

    it('filter drawer and tabs', async () => {
      await create();
      t.openFilters();
      expect(t.isFiltersOpen()).toBe(true);
      reports['getMonthlyWorkbookStatus'].mockClear();
      t.selectTab('monthly-workbook');
      expect(t.isFiltersOpen()).toBe(false);
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledTimes(1);
      t.selectTab('reports');
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledTimes(1);
      t.openFilters();
      t.closeFilters();
      expect(t.isFiltersOpen()).toBe(false);
    });
  });

  describe('exports', () => {
    const cases = [
      ['daily-sales', 'downloadDailySalesExcel', 'downloadDailySalesPdf', 'Daily-Sales-Summary'],
      ['product-sales', 'downloadProductSalesExcel', 'downloadProductSalesPdf', 'Product-Sales-Breakdown'],
      ['payments', 'downloadPaymentsExcel', 'downloadPaymentsPdf', 'Payment-Method-Breakdown'],
      ['hourly', 'downloadHourlySalesExcel', 'downloadHourlySalesPdf', 'Hourly-Sales-Distribution'],
      ['staff', 'downloadStaffPerformanceExcel', 'downloadStaffPerformancePdf', 'Staff-Performance'],
    ] as const;

    it.each(cases)('%s downloads Excel and PDF with proper names', async (type, excel, pdf, name) => {
      await create();
      setField('reportType', type);
      t.onReportTypeChanged();

      t.downloadExcel();
      expect(t.isDownloadingExcel()).toBe(true);
      expect(reports[excel]).toHaveBeenCalled();
      await settle();
      expect(fileDownload.saveBlob).toHaveBeenLastCalledWith(
        blob,
        `WTF-${name}-20260301-20260315.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(t.isDownloadingExcel()).toBe(false);

      t.downloadPdf();
      expect(t.isDownloadingPdf()).toBe(true);
      expect(reports[pdf]).toHaveBeenCalled();
      await settle();
      expect(fileDownload.saveBlob).toHaveBeenLastCalledWith(
        blob,
        `WTF-${name}-20260301-20260315.pdf`,
        'application/pdf',
      );
      expect(t.isDownloadingPdf()).toBe(false);
    });

    it.each(cases)('%s export errors alert and reset flags', async (type, excel, pdf) => {
      await create();
      setField('reportType', type);
      t.onReportTypeChanged();
      reports[excel].mockReturnValue(throwError(() => new Error('excel boom')));
      reports[pdf].mockReturnValue(throwError(() => new Error('pdf boom')));
      t.downloadExcel();
      expect(alert['error']).toHaveBeenLastCalledWith('excel boom');
      expect(t.isDownloadingExcel()).toBe(false);
      t.downloadPdf();
      expect(alert['error']).toHaveBeenLastCalledWith('pdf boom');
      expect(t.isDownloadingPdf()).toBe(false);
      expect(fileDownload.saveBlob).not.toHaveBeenCalled();
    });

    it.each(cases)('%s export aborts with invalid range', async (type, excel, pdf) => {
      await create();
      setField('reportType', type);
      t.onReportTypeChanged();
      setField('fromDate', '2027-01-01');
      t.downloadExcel();
      t.downloadPdf();
      expect(reports[excel]).not.toHaveBeenCalled();
      expect(reports[pdf]).not.toHaveBeenCalled();
      expect(t.isDownloadingExcel()).toBe(false);
      expect(t.isDownloadingPdf()).toBe(false);
    });

    it('ignores a second export while one is running', async () => {
      await create();
      fileDownload.saveBlob.mockReturnValue(new Promise(() => undefined));
      t.downloadExcel();
      t.downloadPdf();
      t.downloadExcel();
      expect(reports['downloadDailySalesExcel']).toHaveBeenCalledTimes(1);
      expect(reports['downloadDailySalesPdf']).not.toHaveBeenCalled();
      expect(t.isReportExportBusy()).toBe(true);
    });
  });

  describe('monthly workbook', () => {
    it('status text variants and download availability', async () => {
      await create();
      expect(t.getMonthlyWorkbookStatusText()).toBe('Available: WB.xlsx');
      expect(t.canDownloadMonthlyWorkbook()).toBe(true);
      expect(t.isMonthlyWorkbookDownloadDisabled()).toBe(false);

      reports['getMonthlyWorkbookStatus'].mockReturnValue(
        of(status({ generatedAtUtc: '2026-03-10T08:30:00Z' })),
      );
      t.onMonthlyWorkbookFilterChanged();
      expect(t.getMonthlyWorkbookStatusText()).toMatch(/^Last generated: March 10, 2026 \d{1,2}:\d{2} (AM|PM)$/);

      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ generatedAtUtc: 'junk' })));
      t.onMonthlyWorkbookFilterChanged();
      expect(t.getMonthlyWorkbookStatusText()).toBe('Available: WB.xlsx');

      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ exists: false })));
      t.onMonthlyWorkbookFilterChanged();
      expect(t.getMonthlyWorkbookStatusText()).toBe('Monthly workbook not generated yet.');
      expect(t.canDownloadMonthlyWorkbook()).toBe(false);
      expect(t.isMonthlyWorkbookDownloadDisabled()).toBe(true);
    });

    it('filter change with invalid year clears status silently', async () => {
      await create();
      setField('workbookYear', 1999);
      reports['getMonthlyWorkbookStatus'].mockClear();
      t.onMonthlyWorkbookFilterChanged();
      expect(t.monthlyWorkbookStatus()).toBeNull();
      expect(reports['getMonthlyWorkbookStatus']).not.toHaveBeenCalled();
      expect(alert['error']).not.toHaveBeenCalled();
    });

    it('generates a workbook and stores the status', async () => {
      await create();
      setField('workbookYear', 2025);
      setField('workbookMonth', 12);
      t.generateMonthlyWorkbook();
      expect(reports['generateMonthlyWorkbook']).toHaveBeenCalledWith(2025, 12);
      expect(t.monthlyWorkbookStatus()?.fileName).toBe('Gen.xlsx');
      expect(alert['success']).toHaveBeenCalledWith('Monthly workbook generated: Gen.xlsx');
      expect(t.isGeneratingMonthlyWorkbook()).toBe(false);
    });

    it('generation failure alerts', async () => {
      await create();
      reports['generateMonthlyWorkbook'].mockReturnValue(throwError(() => new Error('gen fail')));
      t.generateMonthlyWorkbook();
      expect(alert['error']).toHaveBeenCalledWith('gen fail');
      expect(t.isGeneratingMonthlyWorkbook()).toBe(false);
    });

    it.each([
      [1999, 3, 'Workbook year must be between 2000 and 2100.'],
      [2101, 3, 'Workbook year must be between 2000 and 2100.'],
      [2026, 13, 'Workbook month must be between 1 and 12.'],
      [0, 3, 'Please select workbook month and year first.'],
      [2026, 0, 'Please select workbook month and year first.'],
    ])('invalid workbook filter (%i, %i) shows an error', async (year, month, message) => {
      await create();
      setField('workbookYear', year);
      setField('workbookMonth', month);
      t.generateMonthlyWorkbook();
      t.downloadMonthlyWorkbook();
      expect(alert['error']).toHaveBeenCalledWith(message);
      expect(reports['generateMonthlyWorkbook']).not.toHaveBeenCalled();
      expect(reports['downloadMonthlyWorkbook']).not.toHaveBeenCalled();
    });

    it('downloads the generated workbook using the status file name', async () => {
      await create();
      t.downloadMonthlyWorkbook();
      expect(t.isDownloadingMonthlyWorkbook()).toBe(true);
      expect(reports['downloadMonthlyWorkbook']).toHaveBeenCalledWith(2026, 3);
      await settle();
      expect(fileDownload.saveBlob).toHaveBeenCalledWith(
        blob,
        'WB.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it('falls back to a generated file name', async () => {
      await create();
      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ fileName: '' })));
      t.downloadMonthlyWorkbook();
      await settle();
      expect(fileDownload.saveBlob.mock.calls[0][1]).toBe('WTF-Monthly-Reports-2026-03.xlsx');
    });

    it('tells the user to generate first when the workbook is missing', async () => {
      await create();
      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ exists: false })));
      t.downloadMonthlyWorkbook();
      expect(alert['info']).toHaveBeenCalledWith('Monthly workbook is not generated yet. Generate it first.');
      expect(reports['downloadMonthlyWorkbook']).not.toHaveBeenCalled();
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it('status check and download failures alert and reset the flag', async () => {
      await create();
      reports['getMonthlyWorkbookStatus'].mockReturnValue(throwError(() => new Error('status fail')));
      t.downloadMonthlyWorkbook();
      expect(alert['error']).toHaveBeenLastCalledWith('status fail');
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);

      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status()));
      reports['downloadMonthlyWorkbook'].mockReturnValue(throwError(() => new Error('dl fail')));
      t.downloadMonthlyWorkbook();
      expect(alert['error']).toHaveBeenLastCalledWith('dl fail');
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it('does not start a second workbook action while busy', async () => {
      await create();
      reports['generateMonthlyWorkbook'].mockReturnValue({ subscribe: vi.fn() });
      t.generateMonthlyWorkbook();
      expect(t.isGeneratingMonthlyWorkbook()).toBe(true);
      t.generateMonthlyWorkbook();
      t.downloadMonthlyWorkbook();
      expect(reports['generateMonthlyWorkbook']).toHaveBeenCalledTimes(1);
      expect(reports['downloadMonthlyWorkbook']).not.toHaveBeenCalled();
    });
  });
  describe('filter count on the Filters button', () => {
    const count = () => (t as unknown as { activeFilterCount: () => number }).activeFilterCount();

    it('is zero for the defaults', async () => {
      await create();
      expect(count()).toBe(0);
    });

    it('counts a changed date range, category and staff', async () => {
      await create();
      setField('preset', 'today');
      expect(count()).toBe(1);
      setField('staffId', 'u1');
      expect(count()).toBe(2);
      setField('categoryId', 3);
      expect(count()).toBe(3);
      setField('preset', 'this-month');
      expect(count()).toBe(2);
    });
  });
});
