import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { StockCountDto, StockCountStatus, StockCountSummaryDto } from '@shared/models';
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

interface Vm {
  form: { patchValue: (value: object) => void };
  start: () => void;
}

describe('StockCountsComponent', () => {
  function setup(options: { canWrite?: boolean; counts?: StockCountSummaryDto[]; start?: unknown } = {}) {
    const service = {
      getCounts: vi.fn().mockReturnValue(of(options.counts ?? [summary()])),
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

  it('lists the counts with their progress and status', () => {
    const { el } = setup();

    const row = el.querySelector('[data-testid="count-row"]');
    expect(row?.textContent).toContain('Weekly milk');
    expect(row?.textContent).toContain('1 of 4 counted');
    expect(row?.textContent).toContain('Counting');
  });

  it('says so when there are no counts', () => {
    const { el } = setup({ counts: [] });

    expect(el.textContent).toContain('No counts yet.');
  });

  it('hides the start form from roles that cannot write stock', () => {
    const { el } = setup({ canWrite: false });

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
