import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AlertService, AuthService, StockAttentionService } from '@core/services';
import { StockAttentionDto, StockAttentionItemDto } from '@shared/models';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockAttentionComponent } from './stock-attention';

const item = (
  name: string,
  status: StockAttentionItemDto['status'],
  quantity: number,
  overrides: Partial<StockAttentionItemDto> = {},
): StockAttentionItemDto => ({
  id: name.toLowerCase(),
  name,
  unitName: 'ml',
  currentQuantity: quantity,
  warningQuantity: 500,
  criticalQuantity: 200,
  status,
  allowNegativeStock: true,
  productCount: 2,
  salesCovered: 3,
  ...overrides,
});

const all = [
  item('Gone', 'OutOfStock', 0),
  item('Crit', 'Critical', 150),
  item('Low', 'Warning', 400),
];

describe('StockAttentionComponent', () => {
  function setup(options: { items?: StockAttentionItemDto[]; canWrite?: boolean; loadError?: boolean; loaded?: boolean; pending?: boolean } = {}) {
    const items = signal(options.items ?? all);
    const loaded = signal(options.loaded ?? true);
    const count = (status: string) => computed(() => items().filter((i) => i.status === status).length);
    const data: StockAttentionDto = {
      items: items(),
      outCount: 0,
      criticalCount: 0,
      warningCount: 0,
      totalCount: items().length,
    };
    const attention = {
      items,
      outCount: count('OutOfStock'),
      criticalCount: count('Critical'),
      warningCount: count('Warning'),
      count: computed(() => items().length),
      hasLoaded: loaded,
      start: vi.fn(),
      stop: vi.fn(),
      load: vi
        .fn()
        .mockReturnValue(options.pending ? NEVER : options.loadError ? throwError(() => new Error('Nope')) : of(data)),
    };
    const alerts = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StockAttentionService, useValue: attention },
        { provide: AlertService, useValue: alerts },
        { provide: AuthService, useValue: { canWriteStockMovements: () => options.canWrite ?? true } },
      ],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StockAttentionComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll('[data-testid="attention-row"]')] as HTMLElement[];
    return { fixture, el, attention, alerts, items, navigate, rows };
  }

  it('lists what is low, in the order the server gave (worst first), with the status on each row', () => {
    const { rows } = setup();

    expect(rows().map((r) => r.getAttribute('data-status'))).toEqual(['OutOfStock', 'Critical', 'Warning']);
    expect(rows()[0].textContent).toContain('Gone');
  });

  it('says what is wrong in one line', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="attention-summary"]')?.textContent).toContain('1 out of stock · 1 critical · 1 running low');
  });

  it('shows the three counts as tiles', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="tile-out"]')?.textContent).toContain('1');
    expect(el.querySelector('[data-testid="tile-critical"]')?.textContent).toContain('1');
    expect(el.querySelector('[data-testid="tile-low"]')?.textContent).toContain('1');
  });

  it('filters by a tile, and pressing it again shows everything', () => {
    const { el, rows, fixture } = setup();
    const out = el.querySelector('[data-testid="tile-out"]') as HTMLButtonElement;

    out.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(1);
    expect(out.getAttribute('aria-pressed')).toBe('true');

    out.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(3);
  });

  it('shows the quantity big, with the unit', () => {
    const { rows } = setup();

    expect(rows()[1].querySelector('[data-testid="attention-quantity"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('150 ml');
  });

  it('says how many more sales the stock covers and how many products depend on it', () => {
    const { rows } = setup();

    expect(rows()[1].textContent).toContain('Enough for 3 more sales · used by 2 products');
  });

  it('says products cannot be made when the item is out', () => {
    const { rows } = setup();

    expect(rows()[0].textContent).toContain('2 products cannot be made');
  });

  it('says so when no product uses the item', () => {
    const { rows } = setup({ items: [item('Spare', 'Warning', 400, { productCount: 0, salesCovered: 0 })] });

    expect(rows()[0].textContent).toContain('No product uses this item');
  });

  it('uses singular wording for one product and one sale', () => {
    const { rows } = setup({ items: [item('Solo', 'Warning', 400, { productCount: 1, salesCovered: 1 })] });

    expect(rows()[0].textContent).toContain('Enough for 1 more sale · used by 1 product');
  });

  it('labels a negative balance as below zero', () => {
    const { rows } = setup({ items: [item('Over', 'OutOfStock', -20)] });

    expect(rows()[0].textContent).toContain('Below zero');
  });

  it('shows the levels so the person knows what low means', () => {
    const { rows } = setup();

    expect(rows()[2].textContent).toContain('Low at 500 ml · Critical at 200 ml');
  });

  it('offers Add Stock with the item preselected, only to people who can add stock', () => {
    const { rows } = setup();
    const add = rows()[1].querySelector('[data-testid="add-stock"]') as HTMLAnchorElement;
    expect(add.getAttribute('href')).toBe('/inventory/stock-in?itemId=crit');
    TestBed.resetTestingModule();

    const viewer = setup({ canWrite: false });
    expect(viewer.rows()[0].querySelector('[data-testid="add-stock"]')).toBeNull();
  });

  it('opens the item when its name is pressed', () => {
    const { rows, navigate } = setup();

    (rows()[1].querySelector('button') as HTMLButtonElement).click();

    expect(navigate).toHaveBeenCalledWith('/inventory/items/details/crit');
  });

  it('shows an all-clear when nothing is low', () => {
    const { el, rows } = setup({ items: [] });

    expect(el.querySelector('[data-testid="all-clear"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(el.querySelector('[data-testid="tile-out"]')).not.toBeNull();
  });

  it('watches stock while the page is open and loads the list', () => {
    const { fixture, attention } = setup();
    expect(attention.start).toHaveBeenCalledTimes(1);
    expect(attention.load).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(attention.stop).toHaveBeenCalledTimes(1);
  });

  it('shows the error when the list cannot be loaded', () => {
    const { alerts } = setup({ loadError: true });

    expect(alerts.error).toHaveBeenCalledWith('Nope');
  });

  it('shows a spinner before the first load, and no tiles', () => {
    const { el } = setup({ loaded: false, items: [], pending: true });

    expect(el.querySelector('.loading')).not.toBeNull();
    expect(el.querySelector('[data-testid="tile-out"]')).toBeNull();
  });
});
