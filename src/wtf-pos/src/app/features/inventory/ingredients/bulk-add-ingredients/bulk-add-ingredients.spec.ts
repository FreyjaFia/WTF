import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertService, InventoryService, ModalStackService } from '@core/services';
import { ItemDto, ProductIngredientsRowDto } from '@shared/models';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BulkAddIngredientsComponent } from './bulk-add-ingredients';

const base: Omit<ProductIngredientsRowDto, 'productId' | 'name' | 'ingredientCount'> = {
  code: '',
  status: 'Missing',
  missingOptions: [],
  price: 100,
  cost: null,
  unknownCostCount: 0,
  margin: null,
  marginPercent: null,
};

const products: ProductIngredientsRowDto[] = [
  { ...base, productId: 'p1', name: 'Latte', ingredientCount: 0, subCategoryName: 'Coffee' },
  { ...base, productId: 'p2', name: 'Mocha', ingredientCount: 2, subCategoryName: 'Coffee' },
  { ...base, productId: 'p3', name: 'Croissant', ingredientCount: 0, subCategoryName: 'Snacks' },
  { ...base, productId: 'p4', name: 'Water', ingredientCount: 0, subCategoryName: null },
];

const cup = { id: 'i1', name: 'Cup', unitName: 'pc', isActive: true } as ItemDto;
const lid = { id: 'i2', name: 'Lid', unitName: 'pc', isActive: true } as ItemDto;

@Component({
  imports: [BulkAddIngredientsComponent],
  template: `<app-bulk-add-ingredients
    [isOpen]="open()"
    [products]="products"
    (closed)="closed = closed + 1"
    (added)="added = added + 1"
  />`,
})
class HostComponent {
  public readonly open = signal(true);
  public readonly products = products;
  public closed = 0;
  public added = 0;
}

describe('BulkAddIngredientsComponent', () => {
  function setup(bulkAdd = vi.fn().mockReturnValue(of({ added: 2, skipped: [] }))) {
    const inventory = {
      getInventoryItems: vi.fn().mockReturnValue(of([cup, lid])),
      bulkAddIngredients: bulkAdd,
    };
    const alerts = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: { push: () => 1, remove: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, inventory, alerts, el };
  }

  const all = (el: HTMLElement, testId: string) => [
    ...el.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];
  const pick = (fixture: { detectChanges: () => void }, el: HTMLElement, index: number) => {
    const box = all(el, 'bulk-product')[index] as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const addItem = (fixture: { detectChanges: () => void }, el: HTMLElement, id: string) => {
    const select = el.querySelector('[data-testid="bulk-add-item"]') as HTMLSelectElement;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const submit = (fixture: { detectChanges: () => void }, el: HTMLElement) => {
    (el.querySelector('[data-testid="bulk-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('groups the products by sub-category with the ones without a group last', () => {
    const { el } = setup();

    expect(all(el, 'bulk-group').map((g) => g.textContent?.trim())).toEqual([
      'Coffee',
      'Snacks',
      'Other',
    ]);
  });

  it('lists a product with no ingredients before one that has some', () => {
    const { el } = setup();

    expect(all(el, 'bulk-product').length).toBe(4);
    const names = [...el.querySelectorAll('ul li label span.min-w-0')].map((s) =>
      s.textContent?.trim(),
    );
    expect(names.slice(0, 2)).toEqual(['Latte', 'Mocha']);
  });

  it('narrows the list with the search box', () => {
    const { fixture, el } = setup();
    const search = el.querySelector('[data-testid="bulk-search"]') as HTMLInputElement;
    search.value = 'cro';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(all(el, 'bulk-product').length).toBe(1);
  });

  it('keeps the add button off until a product and an ingredient are chosen', () => {
    const { fixture, el } = setup();
    const button = () => el.querySelector('[data-testid="bulk-submit"]') as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    pick(fixture, el, 0);
    expect(button().disabled).toBe(true);

    addItem(fixture, el, 'i1');
    expect(button().disabled).toBe(false);
  });

  it('does not offer an ingredient twice', () => {
    const { fixture, el } = setup();
    addItem(fixture, el, 'i1');

    const options = [...el.querySelectorAll('[data-testid="bulk-add-item"] option')].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).not.toContain('Cup');
    expect(options).toContain('Lid');
  });

  it('sends the picked products and lines, then shows the result and tells the page', () => {
    const { fixture, inventory, el } = setup();
    pick(fixture, el, 0);
    pick(fixture, el, 1);
    addItem(fixture, el, 'i1');
    submit(fixture, el);

    expect(inventory.bulkAddIngredients).toHaveBeenCalledWith(
      ['p1', 'p2'],
      [{ itemId: 'i1', quantityPerSale: 1, allowancePercent: 0 }],
    );
    expect(el.querySelector('[data-testid="bulk-result"]')?.textContent).toContain('Added 2');
    expect(fixture.componentInstance.added).toBe(1);
  });

  it('lists what was skipped because the product already had the ingredient', () => {
    const { fixture, el } = setup(
      vi.fn().mockReturnValue(
        of({
          added: 1,
          skipped: [{ productId: 'p2', productName: 'Mocha', itemName: 'Cup' }],
        }),
      ),
    );
    pick(fixture, el, 0);
    addItem(fixture, el, 'i1');
    submit(fixture, el);

    expect(el.querySelector('[data-testid="bulk-skipped"]')?.textContent).toContain('Mocha: Cup');
  });

  it('shows the error and stays on the form when the server refuses', () => {
    const { fixture, alerts, el } = setup(
      vi.fn().mockReturnValue(throwError(() => new Error('Refused.'))),
    );
    pick(fixture, el, 0);
    addItem(fixture, el, 'i1');
    submit(fixture, el);

    expect(alerts.error).toHaveBeenCalledWith('Refused.');
    expect(el.querySelector('[data-testid="bulk-result"]')).toBeNull();
  });
});
