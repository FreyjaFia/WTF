import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { StockCoverageDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StockCoverageComponent } from './stock-coverage';

const coverage: StockCoverageDto = {
  covered: 1,
  partial: 1,
  missing: 1,
  products: [
    { productId: 'p1', name: 'Water', code: 'WATER', status: 'Missing', missingOptions: [] },
    {
      productId: 'p2',
      name: 'Latte',
      code: 'LATTE',
      status: 'Partial',
      missingOptions: ['Size: Large'],
    },
    { productId: 'p3', name: 'Beans', code: 'BEANS', status: 'Covered', missingOptions: [] },
  ],
};

describe('StockCoverageComponent', () => {
  function setup(options: { canWrite?: boolean; canRead?: boolean; result?: unknown } = {}) {
    const inventory = { getStockCoverage: vi.fn().mockReturnValue(options.result ?? of(coverage)) };
    const alerts = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        {
          provide: AuthService,
          useValue: {
            canWriteProducts: () => options.canWrite ?? true,
            canReadProducts: () => options.canRead ?? true,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StockCoverageComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, inventory, alerts, el };
  }

  const rows = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="coverage-row"]')];

  it('shows the three counts', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="coverage-summary"]')?.textContent).toMatch(/1\s*Partly\s*1\s*Take none\s*1/);
  });

  it('lists only the products that need attention by default, gaps first', () => {
    const { el } = setup();
    const listed = rows(el);

    expect(listed.length).toBe(2);
    expect(listed[0].textContent).toContain('Water');
    expect(listed[0].textContent).toContain('Takes no stock');
    expect(listed[1].textContent).toContain('Latte');
    expect(listed[1].textContent).toContain('Some options missing');
    expect(listed[1].querySelector('[data-testid="missing-options"]')?.textContent).toContain('Size: Large');
  });

  it('shows every product when asked', () => {
    const { fixture, el } = setup();
    (fixture.componentInstance as unknown as { setFilter: (v: string) => void }).setFilter('all');
    fixture.detectChanges();

    expect(rows(el).length).toBe(3);
    expect(rows(el)[2].textContent).toContain('Takes stock');
  });

  it('links to the product editor for roles that can write products', () => {
    const { el } = setup({ canWrite: true });
    const link = rows(el)[0].querySelector('a');

    expect(link?.textContent).toContain('Set up stock');
    expect(link?.getAttribute('href')).toBe('/management/products/edit/p1');
  });

  it('links to the product page for read-only roles, and nowhere without access', () => {
    const readOnly = setup({ canWrite: false, canRead: true });
    expect(rows(readOnly.el)[0].querySelector('a')?.getAttribute('href')).toBe('/management/products/details/p1');
    TestBed.resetTestingModule();

    const none = setup({ canWrite: false, canRead: false });
    expect(rows(none.el)[0].querySelector('a')).toBeNull();
  });

  it('says so when everything is covered', () => {
    const { el } = setup({ result: of({ covered: 1, partial: 0, missing: 0, products: [coverage.products[2]] }) });
    expect(rows(el).length).toBe(0);
    expect(el.textContent).toContain('Every product takes stock');
  });

  it('refreshes on demand', () => {
    const { fixture, inventory, el } = setup();
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Refresh')) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(inventory.getStockCoverage).toHaveBeenCalledTimes(2);
  });

  it('shows the server message when loading fails', () => {
    const { alerts } = setup({ result: throwError(() => new Error('Down')) });
    expect(alerts.error).toHaveBeenCalledWith('Down');
  });
});
