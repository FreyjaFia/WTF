import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { PagedResultDto, StockCountDto, StockCountStatus, StockCountSummaryDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockCountsComponent } from './stock-counts';

const summary = (overrides: Partial<StockCountSummaryDto> = {}): StockCountSummaryDto => ({
  id: 'c1',
  name: 'Weekly milk',
  status: StockCountStatus.Open,
  isBlind: false,
  note: null,
  createdAt: '2026-11-02T01:00:00Z',
  createdByName: 'Alain E',
  postedAt: null,
  lineCount: 4,
  countedCount: 1,
  ...overrides,
});

const paged = (items: StockCountSummaryDto[], totalCount = items.length): PagedResultDto<StockCountSummaryDto> => ({
  items,
  page: 1,
  pageSize: 25,
  totalCount,
});

interface Vm {
  form: { patchValue: (value: object) => void };
  start: () => void;
  openForm: () => void;
  toggleSort: (column: 'count' | 'created' | 'progress' | 'status') => void;
  sortDirection: () => string;
  goToPage: (page: number) => void;
  changePageSize: (size: number) => void;
  page: () => number;
  isReloading: () => boolean;
}

describe('StockCountsComponent', () => {
  function setup(options: { canWrite?: boolean; counts?: StockCountSummaryDto[]; start?: unknown } = {}) {
    const service = {
      getCountsPaged: vi.fn().mockReturnValue(of(paged(options.counts ?? [summary()]))),
      startCount: vi
        .fn()
        .mockReturnValue(options.start ?? of({ summary: summary({ id: 'new' }), lines: [] } as StockCountDto)),
    };
    const alerts = { error: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockCountService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteStockMovements: () => options.canWrite ?? true } },
      ],
    });
    const fixture = TestBed.createComponent(StockCountsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const vm = fixture.componentInstance as unknown as Vm;
    return { fixture, service, alerts, el, vm, router: TestBed.inject(Router) };
  }

  describe('sorting and paging on the server', () => {
    const lastQuery = (service: { getCountsPaged: ReturnType<typeof vi.fn> }): Record<string, unknown> =>
      service.getCountsPaged.mock.calls.at(-1)![0];

    it('asks for the first page of 25 in the server order until a column is picked', () => {
      const { service } = setup();
      expect(lastQuery(service)).toEqual({ sortBy: null, sortDirection: null, page: 1, pageSize: 25 });
    });

    it('asks the server to sort, reverses on a second pick and returns to page 1', () => {
      const { vm, service } = setup();
      vm.goToPage(3);

      vm.toggleSort('count');
      expect(lastQuery(service)).toMatchObject({ sortBy: 'count', sortDirection: 'asc', page: 1 });

      vm.toggleSort('count');
      expect(vm.sortDirection()).toBe('desc');
      expect(lastQuery(service)).toMatchObject({ sortBy: 'count', sortDirection: 'desc' });
    });

    it('sorts by created date, progress and status on the server', () => {
      const { vm, service } = setup();
      for (const column of ['created', 'progress', 'status'] as const) {
        vm.toggleSort(column);
        expect(lastQuery(service)).toMatchObject({ sortBy: column, sortDirection: 'asc' });
      }
    });

    it('shows the pagination bar and loads the chosen page', () => {
      const { vm, service, el, fixture } = setup({ counts: [summary()] });
      service.getCountsPaged.mockReturnValue(of(paged([summary()], 60)));
      vm.goToPage(1);
      fixture.detectChanges();
      expect(el.querySelector('app-pagination')).not.toBeNull();

      vm.goToPage(2);

      expect(lastQuery(service)).toMatchObject({ page: 2 });
    });

    it('goes back to page 1 when the rows per page change', () => {
      const { vm, service } = setup();
      vm.goToPage(2);

      vm.changePageSize(50);

      expect(lastQuery(service)).toMatchObject({ page: 1, pageSize: 50 });
    });

    it('follows the page the server returns when the page was past the end', () => {
      const { vm, service } = setup();
      service.getCountsPaged.mockReturnValue(of({ ...paged([summary()], 30), page: 2 }));

      vm.goToPage(9);

      expect(vm.page()).toBe(2);
    });
  });

  it('lists the counts with their progress and status', () => {
    const { el } = setup();

    const row = el.querySelector('[data-testid="count-row"]');
    expect(row?.textContent).toContain('Weekly milk');
    expect(row?.textContent).toContain('1 of 4 counted');
    expect(row?.textContent).toContain('Counting');
  });

  it('says so when there are no counts', () => {
    const { el } = setup({ counts: [] });

    expect(el.textContent).toContain('No counts found');
  });

  it('opens the start form from the Start Count button', () => {
    const { el, fixture } = setup();

    expect(el.querySelector('form')).toBeNull();
    (el.querySelector('[data-testid="open-start"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('form')).not.toBeNull();
  });

  it('hides the start button from roles that cannot write stock', () => {
    const { el } = setup({ canWrite: false });

    expect(el.querySelector('[data-testid="open-start"]')).toBeNull();
    expect(el.querySelector('form')).toBeNull();
  });

  it('does not start a count without a name', () => {
    const { vm, service } = setup();

    vm.start();

    expect(service.startCount).not.toHaveBeenCalled();
  });

  it('starts a count for every item and opens its sheet', () => {
    const { vm, service, fixture, router } = setup();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    vm.form.patchValue({ name: '  Friday  ', isBlind: true });
    vm.start();
    fixture.detectChanges();

    expect(service.startCount).toHaveBeenCalledWith({ name: 'Friday', isBlind: true, note: null, itemIds: null });
    expect(navigate).toHaveBeenCalledWith('/inventory/counts/new');
  });

  it('shows the refusal when starting fails', () => {
    const { vm, alerts } = setup({ start: throwError(() => new Error('There are no active items to count.')) });

    vm.form.patchValue({ name: 'Friday' });
    vm.start();

    expect(alerts.error).toHaveBeenCalledWith('There are no active items to count.');
  });
});
