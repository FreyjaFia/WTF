import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService, AuthService, InventoryService } from '@core/services';
import { ProductIngredientsDto, ProductIngredientsRowDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { IngredientsComponent } from './ingredients';

const empty = {
  ingredientCount: 0,
  cost: null,
  unknownCostCount: 0,
  margin: null,
  marginPercent: null,
};

const water: ProductIngredientsRowDto = {
  productId: 'p1',
  name: 'Water',
  code: 'WATER',
  status: 'Missing',
  missingOptions: [],
  price: 20,
  ...empty,
};
const latte: ProductIngredientsRowDto = {
  productId: 'p2',
  name: 'Latte',
  code: 'LATTE',
  status: 'Partial',
  missingOptions: ['Size: Large'],
  price: 150,
  ingredientCount: 2,
  cost: 34,
  unknownCostCount: 1,
  margin: 116,
  marginPercent: 77.33,
};
const beans: ProductIngredientsRowDto = {
  productId: 'p3',
  name: 'Beans',
  code: 'BEANS',
  status: 'Covered',
  missingOptions: [],
  price: 100,
  ingredientCount: 1,
  cost: 90,
  unknownCostCount: 0,
  margin: 10,
  marginPercent: 10,
};

const data: ProductIngredientsDto = {
  ready: 1,
  partial: 1,
  missing: 1,
  showsCosts: true,
  products: [water, latte, beans],
};

describe('IngredientsComponent', () => {
  function setup(options: { canWrite?: boolean; canRead?: boolean; result?: unknown } = {}) {
    const inventory = {
      getProductIngredients: vi.fn().mockReturnValue(options.result ?? of(data)),
    };
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
    const fixture = TestBed.createComponent(IngredientsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, inventory, alerts, el };
  }

  const rows = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="coverage-row"]')];
  const click = (fixture: { detectChanges: () => void }, el: HTMLElement, testId: string) => {
    (el.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('shows the three counts', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="coverage-summary"]')?.textContent).toMatch(
      /1\s*Partly\s*1\s*Take none\s*1/,
    );
  });

  it('lists only the products that need attention by default, gaps first', () => {
    const { el } = setup();
    const listed = rows(el);

    expect(listed.length).toBe(2);
    expect(listed[0].textContent).toContain('Water');
    expect(listed[0].textContent).toContain('Takes no stock');
    expect(listed[1].textContent).toContain('Latte');
    expect(listed[1].textContent).toContain('Some options missing');
    expect(listed[1].querySelector('[data-testid="missing-options"]')?.textContent).toContain(
      'Size: Large',
    );
  });

  it('shows the price and the number of ingredients on every row', () => {
    const { el } = setup();

    expect(rows(el)[0].querySelector('[data-testid="product-facts"]')?.textContent).toMatch(
      /₱20\.00\s*·\s*0 ingredients/,
    );
    expect(rows(el)[1].querySelector('[data-testid="product-facts"]')?.textContent).toMatch(
      /2 ingredients/,
    );
  });

  it('shows the cost and the margin to roles that can read costs', () => {
    const { el } = setup();
    const facts = rows(el)[1].querySelector('[data-testid="product-facts"]')?.textContent ?? '';

    expect(facts).toContain('Cost ₱34.00');
    expect(facts).toMatch(/Margin ₱116\.00\s*\(77\.33%\)/);
    expect(rows(el)[1].querySelector('[data-testid="unknown-costs"]')?.textContent).toContain(
      '1 without a cost',
    );
  });

  it('shows no cost, margin or low-margin filter when the roles cannot read costs', () => {
    const hidden: ProductIngredientsDto = {
      ...data,
      showsCosts: false,
      products: [
        water,
        { ...latte, cost: null, margin: null, marginPercent: null, unknownCostCount: 0 },
        beans,
      ],
    };
    const { el } = setup({ result: of(hidden) });

    expect(rows(el)[1].querySelector('[data-testid="product-facts"]')?.textContent).not.toContain(
      'Cost',
    );
    expect(el.querySelector('[data-testid="filter-low-margin"]')).toBeNull();
  });

  it('shows every product when asked', () => {
    const { fixture, el } = setup();
    click(fixture, el, 'filter-all');

    expect(rows(el).length).toBe(3);
    expect(rows(el)[2].textContent).toContain('Takes stock');
  });

  it('lists only the products under the low margin with its own filter', () => {
    const { fixture, el } = setup();

    expect(el.querySelector('[data-testid="filter-low-margin"]')?.textContent).toContain(
      'Low margin (1)',
    );
    click(fixture, el, 'filter-low-margin');

    expect(rows(el)).toHaveLength(1);
    expect(rows(el)[0].textContent).toContain('Beans');
    expect(rows(el)[0].querySelector('[data-testid="product-margin"]')?.className).toContain(
      'text-red-700',
    );
  });

  it('links to the product editor for roles that can write products', () => {
    const { el } = setup({ canWrite: true });
    const link = rows(el)[0].querySelector('a');

    expect(link?.textContent).toContain('Set up stock');
    expect(link?.getAttribute('href')).toBe('/management/products/edit/p1');
  });

  it('links to the product page for read-only roles, and nowhere without access', () => {
    const readOnly = setup({ canWrite: false, canRead: true });
    expect(rows(readOnly.el)[0].querySelector('a')?.getAttribute('href')).toBe(
      '/management/products/details/p1',
    );
    TestBed.resetTestingModule();

    const none = setup({ canWrite: false, canRead: false });
    expect(rows(none.el)[0].querySelector('a')).toBeNull();
  });

  it('says so when everything is covered', () => {
    const { el } = setup({
      result: of({ ready: 1, partial: 0, missing: 0, showsCosts: true, products: [beans] }),
    });
    expect(rows(el).length).toBe(0);
    expect(el.textContent).toContain('Every product takes stock');
  });

  it('refreshes on demand', () => {
    const { fixture, inventory, el } = setup();
    (el.querySelector('button[aria-label="Refresh ingredients"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(inventory.getProductIngredients).toHaveBeenCalledTimes(2);
  });

  it('shows the server message when loading fails', () => {
    const { alerts } = setup({ result: throwError(() => new Error('Down')) });
    expect(alerts.error).toHaveBeenCalledWith('Down');
  });

  it('shows how much of the menu takes stock as a percentage', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="coverage-percent"]')?.textContent?.trim()).toBe('33%');
    expect(el.querySelector('[data-testid="coverage-summary"]')?.textContent).toContain(
      'of 3 products take stock',
    );
  });

  it('counts the products to set up on the filter pill', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="filter-attention"]')?.textContent).toContain(
      'Needs setup (2)',
    );
    expect(el.querySelector('[data-testid="filter-all"]')?.textContent).toContain(
      'All products (3)',
    );
  });

  it('narrows the list by name or code', () => {
    const { fixture, el } = setup();
    click(fixture, el, 'filter-all');

    const input = el.querySelector('app-search-input input') as HTMLInputElement;
    input.value = 'lat';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(rows(el)).toHaveLength(1);
    expect(rows(el)[0].textContent).toContain('Latte');

    input.value = 'nothing';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="coverage-empty"]')?.textContent).toContain(
      'No products match your search',
    );
  });
});
