import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  FileDownloadService,
  ReportsService,
  UserService,
} from '@core/services';
import { MonthlyReportWorkbookStatusDto, ReportType } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportRow } from './report-definitions';
import { ReportsComponent } from './reports';

interface Reports {
  selectedType: () => ReportType | null;
  rows: () => ReportRow[];
  visibleRows: () => ReportRow[];
  totals: () => { label: string; value: number }[];
  chartPoints: () => { label: string; value: number }[];
  catalog: { group: string; reports: { type: ReportType }[] }[];
  isLoading: () => boolean;
  isRefreshing: () => boolean;
  connectionFailed: () => boolean;
  isDownloadingExcel: () => boolean;
  isDownloadingPdf: () => boolean;
  isDownloadingCsv: () => boolean;
  isGeneratingMonthlyWorkbook: () => boolean;
  isDownloadingMonthlyWorkbook: () => boolean;
  searchTerm: { set: (v: string) => void; (): string };
  sortKey: () => string | null;
  sortDirection: () => string;
  isFiltersOpen: () => boolean;
  staffOptions: () => { id: string; name: string }[];
  monthlyWorkbookStatus: () => MonthlyReportWorkbookStatusDto | null;
  activeTab: () => string;
  activeFilterCount: () => number;
  reportForm: {
    controls: Record<string, { value: unknown; setValue: (v: unknown) => void }>;
    patchValue: (v: object) => void;
    getRawValue: () => Record<string, unknown>;
  };
  openReport: (type: ReportType) => void;
  backToCatalog: () => void;
  openFilters: () => void;
  closeFilters: () => void;
  selectTab: (t: string) => void;
  isReportsTabActive: () => boolean;
  isMonthlyWorkbookTabActive: () => boolean;
  onPresetChanged: (e: Event) => void;
  onDateChanged: () => void;
  onFilterChanged: () => void;
  refresh: () => void;
  hasFilter: (kind: string) => boolean;
  sortBy: (key: string) => void;
  headerOf: (key: string, fallback: string) => string;
  textOf: (row: ReportRow, key: string) => string;
  downloadExcel: () => void;
  downloadPdf: () => void;
  downloadCsv: () => void;
  onMonthlyWorkbookFilterChanged: () => void;
  generateMonthlyWorkbook: () => void;
  downloadMonthlyWorkbook: () => void;
  canDownloadMonthlyWorkbook: () => boolean;
  isReportExportBusy: () => boolean;
  isMonthlyWorkbookDownloadDisabled: () => boolean;
  getMonthlyWorkbookStatusText: () => string;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const paymentRows = [
  { paymentMethod: 'Cash', orderCount: 3, totalAmount: 300, totalPercent: 75 },
  { paymentMethod: 'GCash', orderCount: 1, totalAmount: 100, totalPercent: 25 },
];

describe('ReportsComponent', () => {
  let fixture: ComponentFixture<ReportsComponent>;
  let t: Reports;
  let reports: Record<string, ReturnType<typeof vi.fn>>;
  let fileDownload: { saveBlob: ReturnType<typeof vi.fn> };
  let alert: Record<string, ReturnType<typeof vi.fn>>;
  let users: { getUsers: ReturnType<typeof vi.fn> };
  let queryReport: string | null;
  let canGenerate: boolean;
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

  const open = async (type: ReportType) => {
    t.openReport(type);
    await settle();
  };

  const field = (name: string) => t.reportForm.controls[name];
  const choose = (value: string): Event => {
    const select = document.createElement('select');
    select.add(new Option(value, value));
    select.value = value;
    const ev = new Event('change');
    Object.defineProperty(ev, 'target', { value: select });
    return ev;
  };

  beforeEach(() => {
    // Sunday 15 March 2026, local time.
    queryReport = null;
    canGenerate = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));
    reports = {
      getReport: vi.fn().mockReturnValue(of(paymentRows)),
      downloadReportExcel: vi.fn().mockReturnValue(of(blob)),
      downloadReportPdf: vi.fn().mockReturnValue(of(blob)),
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
          { id: 'u4', firstName: 'Customer', lastName: 'Link', username: 'customer-link' },
        ]),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ReportsService, useValue: reports },
        { provide: FileDownloadService, useValue: fileDownload },
        { provide: AlertService, useValue: alert },
        { provide: UserService, useValue: users },
        { provide: AuthService, useValue: { canGenerateReports: () => canGenerate } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => queryReport } } },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('catalog', () => {
    it('starts on the catalog without loading any report', async () => {
      await create();

      expect(t.selectedType()).toBeNull();
      expect(reports['getReport']).not.toHaveBeenCalled();
      expect(t.isReportsTabActive()).toBe(true);
    });

    it('groups every report once', async () => {
      await create();

      const types = t.catalog.flatMap((section) => section.reports.map((r) => r.type));
      expect(types.length).toBe(13);
      expect(new Set(types).size).toBe(13);
      expect(t.catalog.map((s) => s.group)).toEqual([
        'Sales',
        'Products',
        'Staff',
        'Customers',
        'Operations',
        'Inventory',
      ]);
    });

    it('defaults the range to this month and loads staff and workbook status', async () => {
      await create();

      expect(field('preset').value).toBe('this-month');
      expect(field('fromDate').value).toBe('2026-03-01');
      expect(field('toDate').value).toBe('2026-03-15');
      expect(field('workbookYear').value).toBe(2026);
      expect(field('workbookMonth').value).toBe(3);
      expect(users.getUsers).toHaveBeenCalledWith({ isActive: true });
      expect(t.staffOptions().map((s) => s.name)).toEqual(['Amy A (aa)', 'noname', 'Zed Z (zz)']);
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledWith(2026, 3, null);
      expect(t.monthlyWorkbookStatus()?.fileName).toBe('WB.xlsx');
    });

    it('survives staff and workbook status load failures', async () => {
      users.getUsers.mockReturnValue(throwError(() => new Error('x')));
      reports['getMonthlyWorkbookStatus'].mockReturnValue(throwError(() => new Error('x')));

      await create();

      expect(t.staffOptions()).toEqual([]);
      expect(t.monthlyWorkbookStatus()).toBeNull();
    });

    it('renders the catalog, an open report and the workbook tab', async () => {
      await create();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Daily Sales Summary');

      await open('payments');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('GCash');

      t.selectTab('monthly-workbook');
      fixture.detectChanges();
      expect(t.isMonthlyWorkbookTabActive()).toBe(true);
      expect(t.isReportsTabActive()).toBe(false);
    });
  });

  describe('deep link', () => {
    it('opens the report named in the report query parameter', async () => {
      queryReport = 'voids';

      await create();

      expect(t.selectedType()).toBe('voids');
      expect(reports['getReport']).toHaveBeenCalledWith('voids', expect.anything());
    });

    it('stays on the catalog for an unknown report name', async () => {
      queryReport = 'nope';

      await create();

      expect(t.selectedType()).toBeNull();
      expect(reports['getReport']).not.toHaveBeenCalled();
    });
  });

  describe('opening a report', () => {
    beforeEach(create);

    it('loads it with the date range only when no other filter applies', async () => {
      await open('payments');

      expect(reports['getReport']).toHaveBeenCalledWith('payments', {
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
      });
      expect(t.selectedType()).toBe('payments');
      expect(t.rows()).toEqual(paymentRows);
      expect(t.isLoading()).toBe(false);
    });

    it('applies the definition default sort', async () => {
      await open('daily-sales');

      expect(t.sortKey()).toBe('periodStart');
      expect(t.sortDirection()).toBe('desc');
    });

    it('clears the search and the previous rows when switching reports', async () => {
      await open('payments');
      t.searchTerm.set('cash');

      await open('hourly');

      expect(t.searchTerm()).toBe('');
    });

    it('sends the group by for the daily report', async () => {
      await open('daily-sales');

      expect(reports['getReport']).toHaveBeenCalledWith('daily-sales', {
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
        groupBy: 'Day',
      });
    });

    it('sends category, sub category and split add-ons for the product report', async () => {
      field('categoryId').setValue(1);
      field('subCategoryId').setValue(2);
      field('splitAddOns').setValue(true);

      await open('product-sales');

      expect(reports['getReport']).toHaveBeenCalledWith('product-sales', {
        fromDate: '2026-03-01',
        toDate: '2026-03-15',
        categoryId: 1,
        subCategoryId: 2,
        splitAddOns: true,
      });
    });

    it('sends the staff filter only to the staff report', async () => {
      field('staffId').setValue(' u1 ');

      await open('staff');
      await open('payments');

      expect(reports['getReport']).toHaveBeenCalledWith('staff', expect.objectContaining({ staffId: 'u1' }));
      expect(reports['getReport']).toHaveBeenLastCalledWith('payments', expect.not.objectContaining({ staffId: 'u1' }));
    });

    it('sends the source to reports that use it, but not to customer links', async () => {
      field('source').setValue(0);

      await open('payments');
      expect(reports['getReport']).toHaveBeenLastCalledWith('payments', expect.objectContaining({ source: 0 }));

      await open('customer-links');
      expect(reports['getReport']).toHaveBeenLastCalledWith(
        'customer-links',
        expect.not.objectContaining({ source: 0 }),
      );
    });

    it('sends no dates to the stock report', async () => {
      await open('stock-status');

      expect(reports['getReport']).toHaveBeenCalledWith('stock-status', {});
    });

    it('refuses a reversed date range', async () => {
      field('fromDate').setValue('2026-03-10');
      field('toDate').setValue('2026-03-01');

      await open('payments');

      expect(reports['getReport']).not.toHaveBeenCalled();
      expect(alert['error']).toHaveBeenCalledWith('From date must be earlier than or equal to To date.');
      expect(t.isLoading()).toBe(false);
    });

    it('asks for dates when one is empty', async () => {
      field('toDate').setValue('');

      await open('payments');

      expect(reports['getReport']).not.toHaveBeenCalled();
      expect(alert['error']).toHaveBeenCalledWith('Please select report filters first.');
    });

    it('shows a network failure as a connection error and empties the table', async () => {
      reports['getReport'].mockReturnValue(throwError(() => new Error(HttpErrorMessages.NetworkUnavailable)));

      await open('payments');

      expect(t.connectionFailed()).toBe(true);
      expect(t.rows()).toEqual([]);
      expect(alert['error']).toHaveBeenCalledWith(HttpErrorMessages.NetworkUnavailable);
    });

    it('shows another failure as an alert only', async () => {
      reports['getReport'].mockReturnValue(throwError(() => new Error('Bad range')));

      await open('payments');

      expect(t.connectionFailed()).toBe(false);
      expect(alert['error']).toHaveBeenCalledWith('Bad range');
      expect(t.isLoading()).toBe(false);
    });

    it('ignores a slow answer for a report the user already left', async () => {
      const slow = new Subject<ReportRow[]>();
      reports['getReport'].mockReturnValueOnce(slow);
      t.openReport('payments');
      reports['getReport'].mockReturnValueOnce(of([{ hour: 9, orderCount: 1, revenue: 5 }]));
      t.openReport('hourly');
      await settle();

      slow.next(paymentRows);

      expect(t.selectedType()).toBe('hourly');
      expect(t.rows()).toEqual([{ hour: 9, orderCount: 1, revenue: 5 }]);
    });

    it('goes back to the catalog', async () => {
      await open('payments');

      t.backToCatalog();

      expect(t.selectedType()).toBeNull();
      expect(t.rows()).toEqual([]);
      expect(t.connectionFailed()).toBe(false);
    });
  });

  describe('table behaviour', () => {
    beforeEach(async () => {
      await create();
      await open('payments');
    });

    it('computes the totals and chart points from the rows shown', () => {
      expect(t.totals().find((x) => x.label === 'Total Amount')?.value).toBe(400);
      expect(t.chartPoints().map((p) => p.label)).toEqual(['Cash', 'GCash']);

      t.searchTerm.set('gcash');

      expect(t.visibleRows().length).toBe(1);
      expect(t.totals().find((x) => x.label === 'Total Amount')?.value).toBe(100);
    });

    it('sorts by a column, flipping the direction on a second press', () => {
      t.sortBy('totalAmount');
      expect(t.sortKey()).toBe('totalAmount');
      expect(t.sortDirection()).toBe('asc');
      expect(t.visibleRows().map((r) => r['paymentMethod'])).toEqual(['GCash', 'Cash']);

      t.sortBy('totalAmount');
      expect(t.sortDirection()).toBe('desc');
      expect(t.visibleRows().map((r) => r['paymentMethod'])).toEqual(['Cash', 'GCash']);

      t.sortBy('orderCount');
      expect(t.sortDirection()).toBe('asc');
    });

    it('names the period column after the grouping, for the daily report only', async () => {
      expect(t.headerOf('periodStart', 'Date')).toBe('Date');

      await open('daily-sales');
      field('groupBy').setValue('Month');
      expect(t.headerOf('periodStart', 'Date')).toBe('Month');
      expect(t.headerOf('orderCount', 'Orders')).toBe('Orders');
    });

    it('gives the text of a cell as the table shows it', () => {
      expect(t.textOf(paymentRows[0], 'totalAmount')).toBe('300.00');
      expect(t.textOf(paymentRows[0], 'nope')).toBe('');
    });

    it('knows which filters the open report offers', async () => {
      expect(t.hasFilter('staff')).toBe(false);
      await open('staff');
      expect(t.hasFilter('staff')).toBe(true);
    });

    it('opens and closes the filters drawer', () => {
      t.openFilters();
      expect(t.isFiltersOpen()).toBe(true);
      t.closeFilters();
      expect(t.isFiltersOpen()).toBe(false);
    });

    it('counts the filters that differ from the defaults', () => {
      expect(t.activeFilterCount()).toBe(0);

      field('source').setValue(1);
      field('splitAddOns').setValue(true);
      field('groupBy').setValue('Week');

      expect(t.activeFilterCount()).toBe(3);
    });

    it('reloads when a filter changes and when refreshed', () => {
      reports['getReport'].mockClear();

      t.onFilterChanged();
      expect(reports['getReport']).toHaveBeenCalledTimes(1);

      t.refresh();
      expect(reports['getReport']).toHaveBeenCalledTimes(2);
      expect(t.isRefreshing()).toBe(false);
    });
  });

  describe('date presets', () => {
    beforeEach(async () => {
      await create();
      await open('payments');
      reports['getReport'].mockClear();
    });

    it('applies a preset and reloads', () => {
      t.onPresetChanged(choose('last-month'));

      expect(field('fromDate').value).toBe('2026-02-01');
      expect(field('toDate').value).toBe('2026-02-28');
      expect(reports['getReport']).toHaveBeenCalledWith('payments', {
        fromDate: '2026-02-01',
        toDate: '2026-02-28',
      });
    });

    it('keeps the dates on custom and lets the user pick them', () => {
      t.onPresetChanged(choose('custom'));
      expect(field('fromDate').value).toBe('2026-03-01');

      field('fromDate').setValue('2026-03-05');
      t.onDateChanged();

      expect(reports['getReport']).toHaveBeenLastCalledWith('payments', {
        fromDate: '2026-03-05',
        toDate: '2026-03-15',
      });
    });

    it('switches to custom when a date is edited by hand', () => {
      field('toDate').setValue('2026-03-10');

      t.onDateChanged();

      expect(field('preset').value).toBe('custom');
    });
  });

  describe('exports', () => {
    beforeEach(async () => {
      await create();
      await open('payments');
    });

    it('downloads Excel with the on-screen search and sort', async () => {
      t.searchTerm.set('cash');
      t.sortBy('totalAmount');
      t.sortBy('totalAmount');

      t.downloadExcel();
      await settle();

      expect(reports['downloadReportExcel']).toHaveBeenCalledWith(
        'payments',
        { fromDate: '2026-03-01', toDate: '2026-03-15' },
        { search: 'cash', sortBy: 'totalAmount', sortDir: 'desc' },
      );
      expect(fileDownload.saveBlob).toHaveBeenCalledWith(
        blob,
        'WTF-Payment-Method-Breakdown-20260301-20260315.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(t.isDownloadingExcel()).toBe(false);
    });

    it('downloads PDF', async () => {
      t.downloadPdf();
      await settle();

      expect(reports['downloadReportPdf']).toHaveBeenCalledWith(
        'payments',
        { fromDate: '2026-03-01', toDate: '2026-03-15' },
        { search: '', sortBy: 'totalAmount', sortDir: 'desc' },
      );
      expect(fileDownload.saveBlob).toHaveBeenCalledWith(
        blob,
        'WTF-Payment-Method-Breakdown-20260301-20260315.pdf',
        'application/pdf',
      );
    });

    it('shows the error and frees the button when a download fails', async () => {
      reports['downloadReportExcel'].mockReturnValue(throwError(() => new Error('nope')));

      t.downloadExcel();
      await settle();

      expect(alert['error']).toHaveBeenCalledWith('nope');
      expect(t.isDownloadingExcel()).toBe(false);
      expect(fileDownload.saveBlob).not.toHaveBeenCalled();
    });

    it('does not start a second download while one is running', async () => {
      const pending = new Subject<Blob>();
      reports['downloadReportExcel'].mockReturnValue(pending);

      t.downloadExcel();
      t.downloadPdf();
      t.downloadCsv();

      expect(t.isReportExportBusy()).toBe(true);
      expect(reports['downloadReportPdf']).not.toHaveBeenCalled();
      expect(fileDownload.saveBlob).not.toHaveBeenCalled();
    });

    it('does not download when the dates are invalid', () => {
      field('fromDate').setValue('2026-04-01');

      t.downloadExcel();

      expect(reports['downloadReportExcel']).not.toHaveBeenCalled();
      expect(alert['error']).toHaveBeenCalled();
    });

    it('saves a CSV of the rows shown, with a byte order mark', async () => {
      t.searchTerm.set('gcash');

      t.downloadCsv();
      await settle();

      const [saved, name, type] = fileDownload.saveBlob.mock.calls[0] as [Blob, string, string];
      expect(name).toBe('WTF-Payment-Method-Breakdown-20260301-20260315.csv');
      expect(type).toBe('text/csv');
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(saved);
      });
      expect(text).toContain('Payment Method,Orders,Gross,Discount,Refunded,Net,Tips,Net %');
      expect(text).toContain('GCash,1,');
      expect(text).not.toContain('Cash,3');
      expect(text).toContain('Total,1,')
      expect(t.isDownloadingCsv()).toBe(false);
    });

    it('names a report without a range after today', async () => {
      await open('stock-status');

      t.downloadCsv();
      await settle();

      expect(fileDownload.saveBlob.mock.calls[0][1]).toMatch(/^WTF-Stock-Status-\d{8}\.csv$/);
    });

    it('does nothing on the catalog', async () => {
      t.backToCatalog();

      t.downloadExcel();
      t.downloadCsv();

      expect(reports['downloadReportExcel']).not.toHaveBeenCalled();
      expect(fileDownload.saveBlob).not.toHaveBeenCalled();
    });
  });

  describe('generate permission', () => {
    const button = (text: string): HTMLButtonElement | undefined =>
      Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(text),
      );

    it('shows Generate Monthly to roles that may generate', async () => {
      canGenerate = true;
      await create();
      t.selectTab('monthly-workbook');
      fixture.detectChanges();

      expect(button('Generate Monthly')).toBeDefined();
    });

    it('hides Generate Monthly from read-only roles such as AdminViewer, but keeps Download', async () => {
      canGenerate = false;
      await create();
      t.selectTab('monthly-workbook');
      fixture.detectChanges();

      expect(button('Generate Monthly')).toBeUndefined();
      expect(button('Download Workbook')).toBeDefined();
    });
  });

  describe('monthly workbook', () => {
    beforeEach(async () => {
      await create();
      reports['getMonthlyWorkbookStatus'].mockClear();
      t.selectTab('monthly-workbook');
    });

    it('asks for the chosen source when it checks and generates', () => {
      field('workbookSource').setValue(0);
      t.onMonthlyWorkbookFilterChanged();
      t.generateMonthlyWorkbook();

      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenLastCalledWith(2026, 3, 0);
      expect(reports['generateMonthlyWorkbook']).toHaveBeenCalledWith(2026, 3, 0);
    });

    it('checks the status when its tab opens or the month changes', () => {
      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenCalledWith(2026, 3, null);

      field('workbookMonth').setValue(2);
      t.onMonthlyWorkbookFilterChanged();

      expect(reports['getMonthlyWorkbookStatus']).toHaveBeenLastCalledWith(2026, 2, null);
    });

    it('generates the workbook', () => {
      t.generateMonthlyWorkbook();

      expect(reports['generateMonthlyWorkbook']).toHaveBeenCalledWith(2026, 3, null);
      expect(t.monthlyWorkbookStatus()?.fileName).toBe('Gen.xlsx');
      expect(alert['success']).toHaveBeenCalledWith('Monthly workbook generated: Gen.xlsx');
      expect(t.isGeneratingMonthlyWorkbook()).toBe(false);
    });

    it('reports a failed generate', () => {
      reports['generateMonthlyWorkbook'].mockReturnValue(throwError(() => new Error('boom')));

      t.generateMonthlyWorkbook();

      expect(alert['error']).toHaveBeenCalledWith('boom');
      expect(t.isGeneratingMonthlyWorkbook()).toBe(false);
    });

    it('downloads an existing workbook under the name the server gave', async () => {
      t.downloadMonthlyWorkbook();
      await settle();

      expect(reports['downloadMonthlyWorkbook']).toHaveBeenCalledWith(2026, 3, null);
      expect(fileDownload.saveBlob).toHaveBeenCalledWith(
        blob,
        'WB.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it('falls back to a built file name', async () => {
      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ fileName: '' })));

      t.downloadMonthlyWorkbook();
      await settle();

      expect(fileDownload.saveBlob.mock.calls[0][1]).toBe('WTF-Monthly-Reports-2026-03.xlsx');
    });

    it('asks to generate first when there is no workbook', async () => {
      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ exists: false })));

      t.downloadMonthlyWorkbook();
      await settle();

      expect(alert['info']).toHaveBeenCalledWith('Monthly workbook is not generated yet. Generate it first.');
      expect(reports['downloadMonthlyWorkbook']).not.toHaveBeenCalled();
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it('reports a failed status check or download', async () => {
      reports['getMonthlyWorkbookStatus'].mockReturnValue(throwError(() => new Error('s')));
      t.downloadMonthlyWorkbook();
      await settle();
      expect(alert['error']).toHaveBeenLastCalledWith('s');

      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status()));
      reports['downloadMonthlyWorkbook'].mockReturnValue(throwError(() => new Error('d')));
      t.downloadMonthlyWorkbook();
      await settle();
      expect(alert['error']).toHaveBeenLastCalledWith('d');
      expect(t.isDownloadingMonthlyWorkbook()).toBe(false);
    });

    it.each([
      ['year', 1999, 'Workbook year must be between 2000 and 2100.'],
      ['year', 2101, 'Workbook year must be between 2000 and 2100.'],
      ['month', 13, 'Workbook month must be between 1 and 12.'],
      ['year', 0, 'Please select workbook month and year first.'],
    ])('refuses an invalid %s of %s', (name, value, message) => {
      field(name === 'year' ? 'workbookYear' : 'workbookMonth').setValue(value);

      t.generateMonthlyWorkbook();

      expect(alert['error']).toHaveBeenCalledWith(message);
      expect(reports['generateMonthlyWorkbook']).not.toHaveBeenCalled();
    });

    it('describes the workbook status', () => {
      expect(t.canDownloadMonthlyWorkbook()).toBe(true);
      expect(t.isMonthlyWorkbookDownloadDisabled()).toBe(false);
      expect(t.getMonthlyWorkbookStatusText()).toBe('Available: WB.xlsx');
    });

    it('shows the generated time when known and a hint when there is no file', () => {
      reports['getMonthlyWorkbookStatus'].mockReturnValue(
        of(status({ generatedAtUtc: new Date(2026, 2, 10, 14, 5).toISOString() })),
      );
      t.onMonthlyWorkbookFilterChanged();
      expect(t.getMonthlyWorkbookStatusText()).toBe('Last generated: March 10, 2026 2:05 PM');

      reports['getMonthlyWorkbookStatus'].mockReturnValue(of(status({ exists: false })));
      t.onMonthlyWorkbookFilterChanged();
      expect(t.getMonthlyWorkbookStatusText()).toBe('Monthly workbook not generated yet.');
      expect(t.isMonthlyWorkbookDownloadDisabled()).toBe(true);
    });
  });
});
