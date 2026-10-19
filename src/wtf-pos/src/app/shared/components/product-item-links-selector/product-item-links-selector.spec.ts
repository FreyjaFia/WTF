import { TestBed } from '@angular/core/testing';
import { AlertService, InventoryService, ModalStackService, ProductService } from '@core/services';
import { ItemDto, ProductCategoryEnum, ProductDto, ProductItemLinkDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductItemLinksSelectorComponent } from './product-item-links-selector';

interface Row {
  productId: string;
  name: string;
  code: string;
  price: number;
  isAddOn: boolean;
  isActive: boolean;
  quantityPerSale: number;
}

interface Internals {
  isLoading(): boolean;
  isSaving(): boolean;
  availableProducts(): ProductDto[];
  linkedProducts: { (): Row[]; set(v: Row[]): void };
  unitAbbreviation(): string;
  stockImpact(row: Row): string;
  filteredAvailableProducts: ProductDto[];
  getSelectedCount(): number;
  onSearchInput(e: unknown): void;
  onFilterChange(e: unknown): void;
  onQuantityChange(id: string, v: string | number): void;
  removeLinkedProduct(id: string): void;
  save(): void;
  closeModal(): void;
  syncSignalsWithDOM(): void;
}

function prod(
  id: string,
  name: string,
  opts: { isAddOn?: boolean; isActive?: boolean; code?: string } = {},
): ProductDto {
  return {
    id,
    name,
    code: opts.code ?? id.toUpperCase(),
    price: 10,
    category: ProductCategoryEnum.Food,
    isAddOn: opts.isAddOn ?? false,
    isActive: opts.isActive ?? true,
    createdAt: '',
    createdBy: '',
    priceHistory: [],
    addOnCount: 0,
  };
}

function link(productId: string, qty: number, isActive = true): ProductItemLinkDto {
  return {
    id: 'l-' + productId,
    productId,
    productName: 'Name-' + productId,
    productCode: 'Code-' + productId,
    itemId: 'item1',
    quantityPerSale: qty,
    isActive,
  };
}

describe('ProductItemLinksSelectorComponent', () => {
  let products: { getProducts: ReturnType<typeof vi.fn> };
  let inventory: { assignProductItemLinks: ReturnType<typeof vi.fn> };
  let alerts: { error: ReturnType<typeof vi.fn>; successSaved: ReturnType<typeof vi.fn> };
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  const catalog = [
    prod('a', 'Americano', { code: 'AM1' }),
    prod('b', 'Brownie'),
    prod('c', 'Cheese', { isAddOn: true }),
    prod('d', 'Retired', { isActive: false }),
    prod('e', 'Espresso'),
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    products = { getProducts: vi.fn().mockReturnValue(of(catalog)) };
    inventory = { assignProductItemLinks: vi.fn().mockReturnValue(of({ id: 'item1' } as ItemDto)) };
    alerts = { error: vi.fn(), successSaved: vi.fn() };
    stack = { push: vi.fn().mockReturnValue(4), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProductService, useValue: products },
        { provide: InventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: stack },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function setup() {
    const fixture = TestBed.createComponent(ProductItemLinksSelectorComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    return {
      fixture,
      cmp: fixture.componentInstance,
      i: fixture.componentInstance as unknown as Internals,
      saved,
      el: fixture.nativeElement as HTMLElement,
    };
  }

  it('smoke renders the dialog shell', () => {
    const { el } = setup();
    expect(el.querySelector('#product-item-links-modal')).toBeTruthy();
  });

  describe('open', () => {
    it('splits products into linked rows and active available products', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('b', 2), link('d', 1)], 'kilogram');
      expect(i.linkedProducts().map((r) => [r.productId, r.quantityPerSale, r.isActive])).toEqual([
        ['b', 2, true],
        ['d', 1, false],
      ]);
      // linked 'd' is retired; available excludes linked and inactive
      expect(i.availableProducts().map((p) => p.id)).toEqual(['a', 'c', 'e']);
      expect(i.unitAbbreviation()).toBe('kg');
      expect(i.isLoading()).toBe(false);
    });

    it('ignores already-inactive links and remembers their quantity on re-link', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open('item1', [link('a', 5, false)], 'piece');
      expect(i.linkedProducts()).toHaveLength(0);
      expect(i.availableProducts().map((p) => p.id)).toContain('a');
      fixture.detectChanges();
      vi.advanceTimersByTime(100);
      const lists = el.querySelectorAll('ul');
      const available = lists[0];
      const assigned = lists[1];
      assigned.appendChild(available.querySelector('[data-id="a"]') as HTMLElement);
      i.syncSignalsWithDOM();
      expect(i.linkedProducts().map((r) => [r.productId, r.quantityPerSale])).toEqual([['a', 5]]);
    });

    it('falls back to link data when the product no longer exists', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('gone', 3)], 'piece');
      const row = i.linkedProducts()[0];
      expect(row.name).toBe('Name-gone');
      expect(row.code).toBe('Code-gone');
      expect(row.price).toBe(0);
    });

    it('alerts on load failure', () => {
      products.getProducts.mockReturnValue(throwError(() => new Error('down')));
      const { cmp, i } = setup();
      cmp.open('item1', [], 'piece');
      expect(alerts.error).toHaveBeenCalledWith('down');
      expect(i.isLoading()).toBe(false);
    });

    it('shows loading while pending and falls back to raw unit name', () => {
      products.getProducts.mockReturnValue(new Subject());
      const { cmp, i } = setup();
      cmp.open('item1', [], 'bundle');
      expect(i.isLoading()).toBe(true);
      expect(i.unitAbbreviation()).toBe('bundle');
    });

    it('creates sortables after the delay without throwing', () => {
      const { fixture, cmp } = setup();
      cmp.open('item1', [], 'piece');
      fixture.detectChanges();
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });
  });

  describe('filtering', () => {
    it('filters by type', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [], 'piece');
      i.onFilterChange({ target: { value: 'addons' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual(['c']);
      i.onFilterChange({ target: { value: 'products' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual(['a', 'b', 'e']);
      i.onFilterChange({ target: { value: 'all' } });
      expect(i.filteredAvailableProducts).toHaveLength(4);
    });

    it('filters by name or code, case-insensitively', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [], 'piece');
      i.onSearchInput({ target: { value: ' am1 ' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual(['a']);
      i.onSearchInput({ target: { value: 'ESP' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual(['e']);
    });

    it('combines type and search filters and excludes linked products', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 1)], 'piece');
      i.onSearchInput({ target: { value: 'a' } });
      i.onFilterChange({ target: { value: 'products' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual([]);
      i.onSearchInput({ target: { value: 'e' } });
      expect(i.filteredAvailableProducts.map((p) => p.id)).toEqual(['b', 'e']);
    });
  });

  describe('linked rows', () => {
    it('updates quantity for a single row and ignores invalid values', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 1), link('b', 2)], 'piece');
      i.onQuantityChange('a', '2.5');
      expect(i.linkedProducts().find((r) => r.productId === 'a')?.quantityPerSale).toBe(2.5);
      expect(i.linkedProducts().find((r) => r.productId === 'b')?.quantityPerSale).toBe(2);
      i.onQuantityChange('a', 0);
      i.onQuantityChange('a', -1);
      i.onQuantityChange('a', 'abc');
      i.onQuantityChange('a', Infinity);
      expect(i.linkedProducts().find((r) => r.productId === 'a')?.quantityPerSale).toBe(2.5);
    });

    it('removing a row returns an active product to the sorted available list', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('b', 1)], 'piece');
      i.removeLinkedProduct('b');
      expect(i.getSelectedCount()).toBe(0);
      expect(i.availableProducts().map((p) => p.id)).toEqual(['a', 'b', 'c', 'e']);
    });

    it('removing an inactive product does not make it available', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('d', 1)], 'piece');
      i.removeLinkedProduct('d');
      expect(i.availableProducts().map((p) => p.id)).not.toContain('d');
    });

    it('removing an unknown id is a no-op', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('b', 1)], 'piece');
      const before = i.availableProducts().length;
      i.removeLinkedProduct('zzz');
      expect(i.availableProducts()).toHaveLength(before);
      expect(i.getSelectedCount()).toBe(1);
    });

    it('remembers the quantity of a removed row when re-linked via drag', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open('item1', [link('b', 7)], 'piece');
      i.removeLinkedProduct('b');
      fixture.detectChanges();
      const lists = el.querySelectorAll('ul');
      lists[1].appendChild(lists[0].querySelector('[data-id="b"]') as HTMLElement);
      i.syncSignalsWithDOM();
      expect(i.linkedProducts()[0].quantityPerSale).toBe(7);
    });

    it('sync defaults new links to quantity 1 and preserves edited quantities', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open('item1', [link('a', 4)], 'piece');
      i.onQuantityChange('a', 9);
      fixture.detectChanges();
      const lists = el.querySelectorAll('ul');
      lists[1].appendChild(lists[0].querySelector('[data-id="e"]') as HTMLElement);
      i.syncSignalsWithDOM();
      const rows = Object.fromEntries(i.linkedProducts().map((r) => [r.productId, r.quantityPerSale]));
      expect(rows).toEqual({ a: 9, e: 1 });
      expect(i.availableProducts().map((p) => p.id)).toEqual(['b', 'c']);
    });
  });

  describe('save', () => {
    it('does nothing before open', () => {
      const { i } = setup();
      i.save();
      expect(inventory.assignProductItemLinks).not.toHaveBeenCalled();
    });

    it('sends all linked rows as active assignments, emits the item and closes', () => {
      const { cmp, i, saved } = setup();
      cmp.open('item1', [link('a', 2), link('b', 3)], 'piece');
      i.save();
      expect(inventory.assignProductItemLinks).toHaveBeenCalledWith('item1', [
        { productId: 'a', quantityPerSale: 2, isActive: true },
        { productId: 'b', quantityPerSale: 3, isActive: true },
      ]);
      expect(alerts.successSaved).toHaveBeenCalledWith('Product links');
      expect(saved).toHaveBeenCalledWith({ id: 'item1' });
      expect(i.isSaving()).toBe(false);
      expect(i.getSelectedCount()).toBe(0);
    });

    it('rejects duplicate links', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 2)], 'piece');
      const [row] = i.linkedProducts();
      i.linkedProducts.set([row, { ...row }]);
      i.save();
      expect(alerts.error).toHaveBeenCalledWith('Duplicate product links are not allowed.');
      expect(inventory.assignProductItemLinks).not.toHaveBeenCalled();
    });

    it('rejects non-positive quantities', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 2)], 'piece');
      i.linkedProducts.set([{ ...i.linkedProducts()[0], quantityPerSale: 0 }]);
      i.save();
      expect(alerts.error).toHaveBeenCalledWith('Quantity per sale must be greater than zero.');
    });

    it('reports API errors and resets saving', () => {
      inventory.assignProductItemLinks.mockReturnValue(throwError(() => new Error('nope')));
      const { cmp, i, saved } = setup();
      cmp.open('item1', [link('a', 1)], 'piece');
      i.save();
      expect(alerts.error).toHaveBeenCalledWith('nope');
      expect(i.isSaving()).toBe(false);
      expect(saved).not.toHaveBeenCalled();
    });
  });

  describe('modal stack & close', () => {
    it('blocks closing while saving', () => {
      inventory.assignProductItemLinks.mockReturnValue(new Subject());
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 1)], 'piece');
      i.save();
      expect(i.isSaving()).toBe(true);
      i.closeModal();
      expect(i.getSelectedCount()).toBe(1);
    });

    it('resets and unregisters from the stack, and the stack callback closes', () => {
      const { cmp, i } = setup();
      const modal = document.querySelector('#product-item-links-modal') as HTMLDialogElement;
      modal.close = vi.fn();
      cmp.open('item1', [link('a', 1)], 'kilogram');
      cmp.registerOnStack();
      (stack.push.mock.calls[0][0] as () => void)();
      expect(i.getSelectedCount()).toBe(0);
      expect(i.unitAbbreviation()).toBe('');
      expect(modal.close).toHaveBeenCalled();
      expect(stack.remove).toHaveBeenCalledWith(4);
      i.closeModal();
      expect(stack.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('stock impact', () => {
    it('says what one sale takes and how many sales the stock covers', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open('item1', [link('a', 200), link('b', 6000)], 'milliliter', 9800);
      fixture.detectChanges();

      const [first, second] = i.linkedProducts();
      expect(i.stockImpact(first)).toBe('1 sale takes 200 ml. In stock now: enough for 49 sales.');
      expect(i.stockImpact(second)).toBe('1 sale takes 6000 ml. In stock now: enough for 1 sale.');
      expect(el.querySelectorAll('[data-testid="stock-impact"]').length).toBe(2);
    });

    it('says so when the stock is not enough for one sale', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 200)], 'milliliter', 150);
      expect(i.stockImpact(i.linkedProducts()[0])).toBe(
        '1 sale takes 200 ml. In stock now: not enough for one sale.',
      );
    });

    it('follows the quantity as it is edited', () => {
      const { cmp, i } = setup();
      cmp.open('item1', [link('a', 200)], 'milliliter', 1000);
      i.onQuantityChange('a', 500);
      expect(i.stockImpact(i.linkedProducts()[0])).toContain('enough for 2 sales');
    });
  });
});
