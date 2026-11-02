import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AlertService, AuthService, StockCountService } from '@core/services';
import { StockCountDto, StockCountLineDto, StockCountStatus } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockCountSheetComponent } from './stock-count-sheet';

const line = (id: string, name: string, overrides: Partial<StockCountLineDto> = {}): StockCountLineDto => ({
  itemId: id,
  itemName: name,
  unitName: 'ml',
  countedQuantity: null,
  expectedQuantity: null,
  difference: null,
  adjustmentPosted: false,
  ...overrides,
});

const countOf = (status: StockCountStatus, lines: StockCountLineDto[], isBlind = false): StockCountDto => ({
  summary: {
    id: 'c1',
    name: 'Weekly',
    status,
    isBlind,
    note: null,
    createdAt: '2026-11-02T01:00:00Z',
    createdByName: 'Alain E',
    postedAt: null,
    lineCount: lines.length,
    countedCount: lines.filter((l) => l.countedQuantity !== null).length,
  },
  lines,
});

interface Vm {
  controlOf: (itemId: string) => { setValue: (v: number | null) => void; markAsDirty: () => void };
  save: () => void;
  askPost: () => void;
  confirmPost: () => void;
}

describe('StockCountSheetComponent', () => {
  function setup(count: StockCountDto, canWrite = true) {
    const service = {
      getCount: vi.fn().mockReturnValue(of(count)),
      saveLines: vi.fn().mockReturnValue(of(count)),
      postCount: vi.fn().mockReturnValue(of(countOf(StockCountStatus.Posted, count.lines))),
      cancelCount: vi.fn().mockReturnValue(of(countOf(StockCountStatus.Cancelled, count.lines))),
    };
    const alerts = { error: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockCountService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteStockMovements: () => canWrite } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c1' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(StockCountSheetComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const vm = fixture.componentInstance as unknown as Vm;
    const type = (itemId: string, value: number | null) => {
      const control = vm.controlOf(itemId);
      control.setValue(value);
      control.markAsDirty();
      fixture.detectChanges();
    };
    return { fixture, service, alerts, el, vm, type };
  }

  const open = () => countOf(StockCountStatus.Open, [line('a', 'Beans'), line('b', 'Milk')]);

  it('shows an input for every item while the count is open', () => {
    const { el } = setup(open());

    expect(el.querySelectorAll('[data-testid="count-line"] input')).toHaveLength(2);
    expect(el.textContent).toContain('0 of 2 counted');
  });

  it('keeps the expected balance hidden on a blind count', () => {
    const { el } = setup(countOf(StockCountStatus.Open, [line('a', 'Beans')], true));

    expect(el.textContent).toContain('Blind count');
    expect(el.textContent).not.toContain('Expected');
  });

  it('counts what is typed and posts only after saving the changes', () => {
    const { vm, type, service, el } = setup(open());

    type('b', 7);
    expect(el.textContent).toContain('1 of 2 counted');

    vm.askPost();
    vm.confirmPost();

    expect(service.saveLines).toHaveBeenCalledWith('c1', [{ itemId: 'b', countedQuantity: 7 }]);
    expect(service.postCount).toHaveBeenCalledWith('c1');
  });

  it('will not ask to post when nothing is counted', () => {
    const { vm, alerts } = setup(open());

    vm.askPost();

    expect(alerts.error).toHaveBeenCalledWith('Count at least one item before posting.');
  });

  it('saves only the changed lines when saving progress', () => {
    const { vm, type, service } = setup(open());

    type('a', 3);
    vm.save();

    expect(service.saveLines).toHaveBeenCalledWith('c1', [{ itemId: 'a', countedQuantity: 3 }]);
  });

  it('shows the difference of a posted count', () => {
    const posted = countOf(StockCountStatus.Posted, [
      line('a', 'Milk', { countedQuantity: 7, expectedQuantity: 10, difference: -3, adjustmentPosted: true }),
    ]);
    const { el } = setup(posted);

    expect(el.querySelectorAll('[data-testid="count-line"] input')).toHaveLength(0);
    expect(el.textContent).toContain('Expected 10 ml');
    expect(el.textContent).toContain('-3');
    expect(el.textContent).toContain('Posted');
  });

  it('is read only for a role that cannot write stock', () => {
    const { el } = setup(open(), false);

    expect(el.querySelectorAll('[data-testid="count-line"] input')).toHaveLength(0);
    expect(el.textContent).not.toContain('Post Count');
  });

  it('shows the refusal when posting fails', () => {
    const { vm, type, service, alerts } = setup(open());
    service.postCount.mockReturnValue(throwError(() => new Error('This count is already closed.')));

    type('a', 3);
    vm.askPost();
    vm.confirmPost();

    expect(alerts.error).toHaveBeenCalledWith('This count is already closed.');
  });
});
