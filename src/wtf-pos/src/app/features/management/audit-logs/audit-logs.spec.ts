import { TestBed } from '@angular/core/testing';
import {
  AlertService,
  AuditLogService,
  FileDownloadService,
  ListStateService,
} from '@core/services';
import { AuditLogDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushMicrotasks, internals } from '../../../testing/feature-spec-helpers';
import { AuditLogsComponent } from './audit-logs';

const KEY = 'management:audit-logs';

function makeLog(overrides: Partial<AuditLogDto> = {}): AuditLogDto {
  return {
    id: 'a1',
    userId: 'u1',
    userName: 'alice',
    action: 'Create',
    entityType: 'Product',
    entityId: 'e1',
    oldValues: null,
    newValues: null,
    ipAddress: '10.0.0.1',
    timestamp: '2026-03-02T12:00:00Z',
    ...overrides,
  };
}

describe('AuditLogsComponent', () => {
  let service: {
    getAuditLogs: ReturnType<typeof vi.fn>;
    getAuditActions: ReturnType<typeof vi.fn>;
    downloadAuditLogsExcel: ReturnType<typeof vi.fn>;
    downloadAuditLogsPdf: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn> };
  let files: { saveBlob: ReturnType<typeof vi.fn> };
  let listState: { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };

  function create(saved?: Record<string, unknown>) {
    if (saved) {
      listState.load.mockReturnValue(saved);
    }
    TestBed.configureTestingModule({
      providers: [
        { provide: AuditLogService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: FileDownloadService, useValue: files },
        { provide: ListStateService, useValue: listState },
      ],
    });
    const fixture = TestBed.createComponent(AuditLogsComponent);
    fixture.detectChanges();
    return { fixture, vm: internals(fixture.componentInstance) };
  }

  /** The filters sent with the last list request (paging is checked separately). */
  const lastQuery = () => {
    const query = { ...service.getAuditLogs.mock.calls.at(-1)![0] };
    delete query.page;
    delete query.pageSize;
    return query;
  };
  const lastPaging = () => {
    const { page, pageSize } = service.getAuditLogs.mock.calls.at(-1)![0];
    return { page, pageSize };
  };
  const pagedResult = (totalCount: number, page = 1, pageSize = 10) => ({
    items: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) =>
      makeLog({ id: `p${page}-${i}` }),
    ),
    page,
    pageSize,
    totalCount,
  });

  beforeEach(() => {
    service = {
      getAuditLogs: vi.fn(() =>
        of({ items: [makeLog(), makeLog({ id: 'a2', userName: null, action: 'Delete' })], page: 1, pageSize: 50, totalCount: 2 }),
      ),
      getAuditActions: vi.fn(() => of(['Create', 'Delete'])),
      downloadAuditLogsExcel: vi.fn(() => of(new Blob(['x']))),
      downloadAuditLogsPdf: vi.fn(() => of(new Blob(['y']))),
    };
    alerts = { error: vi.fn() };
    files = { saveBlob: vi.fn(() => Promise.resolve()) };
    listState = { load: vi.fn((_k: string, fallback: unknown) => fallback), save: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loading', () => {
    it('loads actions and logs on init with an empty query', () => {
      const { vm } = create();
      expect(service.getAuditActions).toHaveBeenCalledTimes(1);
      expect(service.getAuditLogs).toHaveBeenCalledTimes(1);
      expect(lastQuery()).toEqual({});
      expect(vm['availableActions']()).toEqual(['Create', 'Delete']);
      expect(vm['logs']()).toHaveLength(2);
      expect(vm['isLoading']()).toBe(false);
    });

    it('renders log rows', () => {
      const { fixture } = create();
      const text = (fixture.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('alice');
      expect(text).toContain('Product');
    });

    it('shows a spinner while the logs load', () => {
      service.getAuditLogs.mockReturnValue(new Subject());
      const { vm } = create();
      expect(vm['isLoading']()).toBe(true);
    });

    it('alerts when logs fail to load', () => {
      service.getAuditLogs.mockReturnValue(throwError(() => new Error('logs down')));
      const { vm } = create();
      expect(alerts.error).toHaveBeenCalledWith('logs down');
      expect(vm['isLoading']()).toBe(false);
      expect(vm['isRefreshing']()).toBe(false);
    });

    it('alerts when actions fail to load', () => {
      service.getAuditActions.mockReturnValue(throwError(() => new Error('actions down')));
      const { vm } = create();
      expect(alerts.error).toHaveBeenCalledWith('actions down');
      expect(vm['availableActions']()).toEqual([]);
    });

    it('refresh reloads the logs and clears the refreshing flag', () => {
      const { vm } = create();
      const pending = new Subject();
      service.getAuditLogs.mockReturnValue(pending);
      vm['refresh']();
      expect(vm['isRefreshing']()).toBe(true);
      pending.next({ items: [], page: 1, pageSize: 50, totalCount: 0 });
      expect(vm['isRefreshing']()).toBe(false);
      expect(vm['logs']()).toEqual([]);
    });

    it('opens and closes the filter drawer', () => {
      const { vm } = create();
      vm['openFilters']();
      expect(vm['isFiltersOpen']()).toBe(true);
      vm['closeFilters']();
      expect(vm['isFiltersOpen']()).toBe(false);
    });
  });

  describe('persisted state', () => {
    it('restores saved filters and uses them for the initial query', () => {
      const { vm } = create({
        selectedActions: ['Delete'],
        selectedDateRanges: ['custom'],
        customStartDate: '2026-03-01',
        customEndDate: '2026-03-05',
      });
      expect(listState.load).toHaveBeenCalledWith(KEY, expect.any(Object));
      expect(vm['selectedActions']()).toEqual(['Delete']);
      expect(lastQuery().actions).toEqual(['Delete']);
      expect(lastQuery().fromDate).toBe(new Date('2026-03-01T00:00:00').toISOString());
      expect(lastQuery().toDate).toBe(new Date('2026-03-05T23:59:59.999').toISOString());
    });

    it('tolerates partially saved state', () => {
      const { vm } = create({});
      expect(vm['selectedActions']()).toEqual([]);
      expect(vm['selectedDateRanges']()).toEqual([]);
      expect(vm['customStartDate']()).toBe('');
    });

    it('saves state and reloads whenever a filter changes', () => {
      const { vm } = create();
      service.getAuditLogs.mockClear();
      vm['toggleActionSelection']('Create');
      expect(listState.save).toHaveBeenLastCalledWith(KEY, {
        selectedActions: ['Create'],
        selectedDateRanges: [],
        customStartDate: '',
        customEndDate: '',
        pageSize: 10,
      });
      expect(service.getAuditLogs).toHaveBeenCalledTimes(1);
    });
  });

  describe('action filters', () => {
    it('toggles actions on and off and passes them to the query', () => {
      const { vm } = create();
      vm['toggleActionSelection']('Create');
      vm['toggleActionSelection']('Delete');
      expect(vm['isActionSelected']('Create')).toBe(true);
      expect(lastQuery().actions).toEqual(['Create', 'Delete']);
      vm['toggleActionSelection']('Create');
      expect(vm['isActionSelected']('Create')).toBe(false);
      expect(lastQuery().actions).toEqual(['Delete']);
    });

    it('clearing the actions drops them from the query', () => {
      const { vm } = create();
      vm['toggleActionSelection']('Create');
      vm['clearActionSelections']();
      expect(vm['selectedActions']()).toEqual([]);
      expect(lastQuery().actions).toBeUndefined();
    });
  });

  describe('date filters', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 2, 10, 15, 30, 0, 0));
    });

    it('today starts at local midnight', () => {
      const { vm } = create();
      vm['toggleDateRangeSelection']('today');
      expect(lastQuery()).toEqual({ fromDate: new Date(2026, 2, 10, 0, 0, 0, 0).toISOString() });
      expect(vm['isDateRangeSelected']('today')).toBe(true);
    });

    it('7d and 30d start that many days before now', () => {
      const { vm } = create();
      vm['toggleDateRangeSelection']('7d');
      expect(lastQuery().fromDate).toBe(new Date(2026, 2, 3, 15, 30).toISOString());
      vm['toggleDateRangeSelection']('30d');
      expect(lastQuery().fromDate).toBe(new Date(2026, 1, 8, 15, 30).toISOString());
      expect(vm['isDateRangeSelected']('7d')).toBe(false);
    });

    it('toggling the selected range off removes the date filter', () => {
      const { vm } = create();
      vm['toggleDateRangeSelection']('7d');
      vm['toggleDateRangeSelection']('7d');
      expect(vm['selectedDateRanges']()).toEqual([]);
      expect(lastQuery()).toEqual({});
    });

    it('picking a preset clears custom dates', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      vm['toggleDateRangeSelection']('today');
      expect(vm['customStartDate']()).toBe('');
      expect(vm['customEndDate']()).toBe('');
    });

    it('picking "custom" keeps the entered dates', () => {
      const { vm } = create();
      vm['customStartDate'].set('2026-03-01');
      vm['toggleDateRangeSelection']('custom');
      expect(vm['customStartDate']()).toBe('2026-03-01');
    });

    it('custom range needs both dates before it filters', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      expect(vm['selectedDateRanges']()).toEqual(['custom']);
      expect(lastQuery()).toEqual({});
      vm['onCustomEndDateChanged']('2026-03-05');
      expect(lastQuery()).toEqual({
        fromDate: new Date('2026-03-01T00:00:00').toISOString(),
        toDate: new Date('2026-03-05T23:59:59.999').toISOString(),
      });
    });

    it('clearCustomDateRange empties the dates and drops the filter', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      vm['onCustomEndDateChanged']('2026-03-05');
      vm['clearCustomDateRange']();
      expect(vm['customStartDate']()).toBe('');
      expect(vm['customEndDate']()).toBe('');
      expect(lastQuery()).toEqual({});
    });

    it('clearDateRangeSelections resets everything', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      vm['clearDateRangeSelections']();
      expect(vm['selectedDateRanges']()).toEqual([]);
      expect(vm['customStartDate']()).toBe('');
      expect(lastQuery()).toEqual({});
    });

    it('counts active filters', () => {
      const { vm } = create();
      expect(vm['activeFilterCount']()).toBe(0);
      vm['toggleDateRangeSelection']('today');
      expect(vm['activeFilterCount']()).toBe(1);
      vm['toggleActionSelection']('Create');
      expect(vm['activeFilterCount']()).toBe(2);
      vm['clearDateRangeSelections']();
      expect(vm['activeFilterCount']()).toBe(1);
    });

    it('does not count an incomplete custom range', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      expect(vm['activeFilterCount']()).toBe(0);
    });

    it('exposes the four date range options', () => {
      const { vm } = create();
      expect(vm['dateRangeOptions']().map((o: { id: string }) => o.id)).toEqual([
        'today',
        '7d',
        '30d',
        'custom',
      ]);
    });
  });

  describe('exports', () => {
    const EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 2, 10, 15, 30, 0, 0));
    });

    it('downloads Excel with the current filters and saves it using the dated name', async () => {
      const { vm } = create();
      vm['toggleActionSelection']('Create');
      vm['downloadExcel']();
      expect(service.downloadAuditLogsExcel).toHaveBeenCalledWith({ actions: ['Create'] });
      expect(vm['isDownloadingExcel']()).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
      expect(files.saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        `WTF-Audit-Logs-${today}.xlsx`,
        EXCEL_TYPE,
        'audit-logs',
      );
      await flushMicrotasks();
      expect(vm['isDownloadingExcel']()).toBe(false);
    });

    it('downloads PDF', async () => {
      const { vm } = create();
      vm['downloadPdf']();
      expect(service.downloadAuditLogsPdf).toHaveBeenCalledWith({});
      expect(files.saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^WTF-Audit-Logs-\d{4}-\d{2}-\d{2}\.pdf$/),
        'application/pdf',
        'audit-logs',
      );
      await flushMicrotasks();
      expect(vm['isDownloadingPdf']()).toBe(false);
    });

    it('names the file after an open-ended range', () => {
      const { vm } = create();
      vm['toggleDateRangeSelection']('7d');
      vm['downloadPdf']();
      const from = new Date(2026, 2, 3, 15, 30).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      expect(files.saveBlob.mock.calls[0][1]).toBe(`WTF-Audit-Logs-${from}-${today}.pdf`);
    });

    it('names the file after a custom range', () => {
      const { vm } = create();
      vm['onCustomStartDateChanged']('2026-03-01');
      vm['onCustomEndDateChanged']('2026-03-05');
      vm['downloadPdf']();
      const from = new Date('2026-03-01T00:00:00').toISOString().slice(0, 10);
      const to = new Date('2026-03-05T23:59:59.999').toISOString().slice(0, 10);
      expect(files.saveBlob.mock.calls[0][1]).toBe(`WTF-Audit-Logs-${from}-${to}.pdf`);
    });

    it('ignores a second export while one is running', () => {
      const pending = new Subject<Blob>();
      const pdf = new Subject<Blob>();
      service.downloadAuditLogsExcel.mockReturnValue(pending);
      service.downloadAuditLogsPdf.mockReturnValue(pdf);
      const { vm } = create();
      vm['downloadExcel']();
      vm['downloadPdf']();
      vm['downloadExcel']();
      expect(pending.observed).toBe(true);
      expect(pdf.observed).toBe(false);
      expect(vm['isDownloadingPdf']()).toBe(false);
    });

    it('alerts and releases the busy flag when saving the file fails', async () => {
      files.saveBlob.mockReturnValue(Promise.reject(new Error('disk full')));
      const { vm } = create();
      vm['downloadExcel']();
      await flushMicrotasks();
      expect(alerts.error).toHaveBeenCalledWith('disk full');
      expect(vm['isDownloadingExcel']()).toBe(false);
    });

    it('alerts and releases the busy flag when the export fails', () => {
      service.downloadAuditLogsExcel.mockReturnValue(throwError(() => new Error('export failed')));
      const { vm } = create();
      vm['downloadExcel']();
      expect(alerts.error).toHaveBeenCalledWith('export failed');
      expect(vm['isDownloadingExcel']()).toBe(false);
      expect(files.saveBlob).not.toHaveBeenCalled();
    });
  });


  describe('pagination', () => {
    it('starts on page 1 with 10 rows per page and asks the API for exactly that', () => {
      const { vm } = create();
      expect(vm['page']()).toBe(1);
      expect(vm['pageSize']()).toBe(10);
      expect(lastPaging()).toEqual({ page: 1, pageSize: 10 });
    });

    it('offers 10, 25, 50 and 100 rows per page', () => {
      const { vm } = create();
      expect(vm['pageSizeOptions']).toEqual([10, 25, 50, 100]);
    });

    it('reports the total and the visible range', () => {
      service.getAuditLogs.mockReturnValue(of(pagedResult(95)));
      const { vm } = create();
      expect(vm['totalCount']()).toBe(95);
      expect(vm['totalPages']()).toBe(10);
      expect(vm['firstRow']()).toBe(1);
      expect(vm['lastRow']()).toBe(10);
    });

    it('reports a range of 0 when there are no logs, and one page', () => {
      service.getAuditLogs.mockReturnValue(of(pagedResult(0)));
      const { vm } = create();
      expect(vm['firstRow']()).toBe(0);
      expect(vm['lastRow']()).toBe(0);
      expect(vm['totalPages']()).toBe(1);
    });

    it('shows the last page range correctly', () => {
      service.getAuditLogs.mockReturnValue(of(pagedResult(95, 10)));
      const { vm } = create();
      vm['page'].set(10);
      expect(vm['firstRow']()).toBe(91);
      expect(vm['lastRow']()).toBe(95);
    });

    it('goToPage loads that page and keeps the filters', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(95, q.page, q.pageSize)),
      );
      const { vm } = create();
      vm['toggleActionSelection']('Create');
      service.getAuditLogs.mockClear();

      vm['goToPage'](3);

      expect(vm['page']()).toBe(3);
      expect(lastPaging()).toEqual({ page: 3, pageSize: 10 });
      expect(lastQuery().actions).toEqual(['Create']);
    });

    it('goToPage stays within 1..totalPages and ignores the current page', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(95, q.page, q.pageSize)),
      );
      const { vm } = create();
      service.getAuditLogs.mockClear();

      vm['goToPage'](1);
      expect(service.getAuditLogs).not.toHaveBeenCalled();

      vm['goToPage'](99);
      expect(vm['page']()).toBe(10);
      vm['goToPage'](-5);
      expect(vm['page']()).toBe(1);
    });

    it('changing the page size returns to page 1, reloads and remembers the choice', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(95, q.page, q.pageSize)),
      );
      const { vm } = create();
      vm['goToPage'](4);
      service.getAuditLogs.mockClear();

      vm['onPageSizeChange']({ target: { value: '50' } } as unknown as Event);

      expect(vm['pageSize']()).toBe(50);
      expect(vm['page']()).toBe(1);
      expect(lastPaging()).toEqual({ page: 1, pageSize: 50 });
      expect(listState.save).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ pageSize: 50 }));
    });

    it('ignores a page size that is not offered or unchanged', () => {
      const { vm } = create();
      service.getAuditLogs.mockClear();

      vm['onPageSizeChange']({ target: { value: '7' } } as unknown as Event);
      vm['onPageSizeChange']({ target: { value: 'abc' } } as unknown as Event);
      vm['onPageSizeChange']({ target: { value: '10' } } as unknown as Event);

      expect(vm['pageSize']()).toBe(10);
      expect(service.getAuditLogs).not.toHaveBeenCalled();
    });

    it('restores a saved page size, and falls back to 10 for an invalid one', () => {
      const { vm } = create({
        selectedActions: [],
        selectedDateRanges: [],
        customStartDate: '',
        customEndDate: '',
        pageSize: 25,
      });
      expect(vm['pageSize']()).toBe(25);
      expect(lastPaging()).toEqual({ page: 1, pageSize: 25 });

      TestBed.resetTestingModule();
      const bad = create({
        selectedActions: [],
        selectedDateRanges: [],
        customStartDate: '',
        customEndDate: '',
        pageSize: 33,
      });
      expect(bad.vm['pageSize']()).toBe(10);
    });

    it('always starts on page 1 even though the page size is remembered', () => {
      const { vm } = create({
        selectedActions: [],
        selectedDateRanges: [],
        customStartDate: '',
        customEndDate: '',
        pageSize: 50,
      });
      expect(vm['page']()).toBe(1);
    });

    it('returns to page 1 whenever a filter changes', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(95, q.page, q.pageSize)),
      );
      const { vm } = create();
      vm['goToPage'](5);

      vm['toggleActionSelection']('Create');
      expect(lastPaging().page).toBe(1);

      vm['goToPage'](5);
      vm['toggleDateRangeSelection']('7d');
      expect(lastPaging().page).toBe(1);

      vm['goToPage'](5);
      vm['clearActionSelections']();
      expect(lastPaging().page).toBe(1);
    });

    it('refresh keeps the current page', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(95, q.page, q.pageSize)),
      );
      const { vm } = create();
      vm['goToPage'](4);

      vm['refresh']();

      expect(lastPaging().page).toBe(4);
    });

    it('jumps to the last page that still exists when the current one is empty', () => {
      service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
        of(pagedResult(25, q.page, q.pageSize)),
      );
      const { vm } = create();
      vm['totalCount'].set(95);
      vm['page'].set(9);
      service.getAuditLogs.mockClear();

      vm['refresh']();

      // 25 logs at 10 per page is 3 pages, so page 9 is replaced by page 3.
      expect(vm['page']()).toBe(3);
      expect(lastPaging()).toEqual({ page: 3, pageSize: 10 });
      expect(vm['logs']()).toHaveLength(5);
      expect(vm['isLoading']()).toBe(false);
    });

    describe('page number list', () => {
      it.each([
        [1, 1, [1]],
        [7, 4, [1, 2, 3, 4, 5, 6, 7]],
        [20, 1, [1, 2, null, 20]],
        [20, 10, [1, null, 9, 10, 11, null, 20]],
        [20, 20, [1, null, 19, 20]],
        [20, 3, [1, 2, 3, 4, null, 20]],
      ] as [number, number, (number | null)[]][])(
        '%i pages, on page %i',
        (total, current, expected) => {
          service.getAuditLogs.mockReturnValue(of(pagedResult(total * 10)));
          const { vm } = create();
          vm['page'].set(current);

          expect(vm['pageItems']()).toEqual(expected);
        },
      );
    });

    describe('exports', () => {
      it('never send paging, so the file holds every matching log', () => {
        const { vm } = create();
        vm['goToPage'](1);
        vm['onPageSizeChange']({ target: { value: '25' } } as unknown as Event);
        vm['toggleActionSelection']('Create');

        vm['downloadExcel']();

        const sent = service.downloadAuditLogsExcel.mock.calls.at(-1)![0];
        expect(sent.page).toBeUndefined();
        expect(sent.pageSize).toBeUndefined();
        expect(sent.actions).toEqual(['Create']);
      });
    });

    describe('template', () => {
      it('shows the range, the rows-per-page choice and enabled/disabled Previous and Next', () => {
        service.getAuditLogs.mockReturnValue(of(pagedResult(95)));
        const { fixture } = create();
        const root = fixture.nativeElement as HTMLElement;

        expect(root.textContent).toContain('1 \u2013 10 of 95');
        const select = root.querySelector('select') as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['10', '25', '50', '100']);
        expect(select.value).toBe('10');

        const buttons = Array.from(root.querySelectorAll('nav button')) as HTMLButtonElement[];
        const previous = buttons.find((b) => b.textContent?.trim() === 'Previous')!;
        const next = buttons.find((b) => b.textContent?.trim() === 'Next')!;
        expect(previous.disabled).toBe(true);
        expect(next.disabled).toBe(false);
      });

      it('moves to the next page when Next is clicked', () => {
        service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
          of(pagedResult(95, q.page, q.pageSize)),
        );
        const { fixture, vm } = create();
        const next = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('nav button'),
        ).find((b) => b.textContent?.trim() === 'Next') as HTMLButtonElement;

        next.click();

        expect(vm['page']()).toBe(2);
        expect(lastPaging()).toEqual({ page: 2, pageSize: 10 });
      });

      it('disables Next on the last page', () => {
        service.getAuditLogs.mockImplementation((q: { page: number; pageSize: number }) =>
          of(pagedResult(95, q.page, q.pageSize)),
        );
        const { fixture, vm } = create();
        vm['goToPage'](10);
        fixture.detectChanges();

        const next = Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('nav button'),
        ).find((b) => b.textContent?.trim() === 'Next') as HTMLButtonElement;
        expect(next.disabled).toBe(true);
      });

      it('hides the pager when there are no logs', () => {
        service.getAuditLogs.mockReturnValue(of(pagedResult(0)));
        const { fixture } = create();

        expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
      });
    });
  });

  describe('formatAuditTimestamp', () => {
    it('formats an ISO timestamp as "Month D, YYYY h:mm AM/PM"', () => {
      const { vm } = create();
      const out = vm['formatAuditTimestamp']('2026-03-02T12:00:00Z');
      expect(out).toMatch(/^March \d{1,2}, 2026 \d{1,2}:\d{2} (AM|PM)$/);
    });

    it('returns the original text for invalid dates', () => {
      const { vm } = create();
      expect(vm['formatAuditTimestamp']('not-a-date')).toBe('not-a-date');
    });
  });
  describe('filter count on the Filters button', () => {
    it('shows the number of applied filters on the button', () => {
      const { fixture, vm } = create();
      expect(fixture.nativeElement.querySelector('[data-filter-count]')).toBeNull();

      vm['selectedActions'].set(['Login', 'Logout']);
      fixture.detectChanges();
      expect(vm['activeFilterCount']()).toBe(2);
      expect(fixture.nativeElement.querySelector('[data-filter-count]').textContent.trim()).toBe('2');
    });
  });
});
