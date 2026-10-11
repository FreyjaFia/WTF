import { TestBed } from '@angular/core/testing';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AddOnGroupDto, AddOnTypeEnum, ProductCategoryEnum, ProductDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsSwapperComponent } from './products-swapper';

interface Internals {
  availableProducts: () => ProductDto[];
  linkedProducts: () => (ProductDto & { type: AddOnTypeEnum })[];
  filteredAvailableProducts(): ProductDto[];
  selectedCategory(): ProductCategoryEnum | null;
  isLoading(): boolean;
  isSaving(): boolean;
  saveProducts(): void;
  closeModal(): void;
  onSearchInput(e: unknown): void;
  onCategoryChange(e: unknown): void;
  changeProductType(id: string, e: unknown): void;
  syncSignalsWithDOM(): void;
}

function product(id: string, name: string, category = ProductCategoryEnum.Food): ProductDto {
  return {
    id,
    name,
    code: id.toUpperCase(),
    price: 10,
    category,
    isAddOn: false,
    isActive: true,
    createdAt: '',
    createdBy: '',
    priceHistory: [],
    addOnCount: 0,
  };
}

describe('ProductsSwapperComponent', () => {
  let products: {
    getProducts: ReturnType<typeof vi.fn>;
    getLinkedProducts: ReturnType<typeof vi.fn>;
    assignLinkedProducts: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn>; successSaved: ReturnType<typeof vi.fn> };
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  const all = [
    product('z', 'Zucchini'),
    product('b', 'Burger'),
    product('c', 'Coffee', ProductCategoryEnum.Drink),
    product('a', 'Americano', ProductCategoryEnum.Drink),
  ];
  const groups: AddOnGroupDto[] = [
    { type: AddOnTypeEnum.Flavor, displayName: 'Flavor', options: [product('a', 'Americano')] },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    products = {
      getProducts: vi.fn().mockReturnValue(of(all)),
      getLinkedProducts: vi.fn().mockReturnValue(of(groups)),
      assignLinkedProducts: vi.fn().mockReturnValue(of(undefined)),
    };
    alerts = { error: vi.fn(), successSaved: vi.fn() };
    stack = { push: vi.fn().mockReturnValue(9), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProductService, useValue: products },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: stack },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function setup(addOnId = 'ao1', type?: AddOnTypeEnum) {
    const fixture = TestBed.createComponent(ProductsSwapperComponent);
    fixture.componentInstance.addOnId = addOnId;
    if (type !== undefined) {
      fixture.componentInstance.addOnType = type;
    }
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const i = fixture.componentInstance as unknown as Internals;
    return { fixture, i, el: fixture.nativeElement as HTMLElement };
  }

  it('smoke renders without loading when no addOnId', () => {
    const { el } = setup('');
    expect(el.querySelector('dialog')).toBeTruthy();
    expect(products.getProducts).not.toHaveBeenCalled();
  });

  it('loads non-add-on products and splits available/linked', () => {
    const { i, el } = setup();
    expect(products.getProducts).toHaveBeenCalledWith({ isAddOn: false, isActive: true });
    expect(products.getLinkedProducts).toHaveBeenCalledWith('ao1');
    expect(i.availableProducts().map((p) => p.name)).toEqual(['Burger', 'Coffee', 'Zucchini']);
    expect(i.linkedProducts().map((p) => [p.name, p.type])).toEqual([
      ['Americano', AddOnTypeEnum.Flavor],
    ]);
    expect(i.isLoading()).toBe(false);
    expect(el.querySelectorAll('li[data-id]')).toHaveLength(4);
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });

  it('stops loading silently when requests fail', () => {
    products.getProducts.mockReturnValue(throwError(() => new Error('x')));
    expect(setup().i.isLoading()).toBe(false);
    products.getProducts.mockReturnValue(of(all));
    products.getLinkedProducts.mockReturnValue(throwError(() => new Error('y')));
    expect(setup().i.isLoading()).toBe(false);
  });

  it('shows the spinner while loading', () => {
    products.getProducts.mockReturnValue(new Subject());
    const { i } = setup();
    expect(i.isLoading()).toBe(true);
  });

  it('filters by search term and category together', () => {
    const { i, fixture } = setup();
    i.onSearchInput({ target: { value: ' co ' } });
    expect(i.filteredAvailableProducts().map((p) => p.name)).toEqual(['Coffee']);
    i.onSearchInput({ target: { value: '' } });
    i.onCategoryChange({ target: { value: String(ProductCategoryEnum.Food) } });
    expect(i.filteredAvailableProducts().map((p) => p.name)).toEqual(['Burger', 'Zucchini']);
    i.onSearchInput({ target: { value: 'zuc' } });
    expect(i.filteredAvailableProducts().map((p) => p.name)).toEqual(['Zucchini']);
    i.onSearchInput({ target: { value: 'coffee' } });
    fixture.detectChanges();
    expect(i.filteredAvailableProducts()).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No products match your filters',
    );
  });

  it('clears the category filter when the empty option is chosen', () => {
    const { i } = setup();
    i.onCategoryChange({ target: { value: '2' } });
    expect(i.selectedCategory()).toBe(ProductCategoryEnum.Food);
    i.onCategoryChange({ target: { value: '' } });
    expect(i.selectedCategory()).toBeNull();
  });

  it('changes the type of a single linked product', () => {
    const { i } = setup();
    i.changeProductType('a', { target: { value: '5' } });
    expect(i.linkedProducts()[0].type).toBe(AddOnTypeEnum.Sauce);
  });

  it('syncs from DOM, keeping existing types and defaulting new ones to addOnType', () => {
    const { i, el } = setup('ao1', AddOnTypeEnum.Topping);
    i.changeProductType('a', { target: { value: '5' } });
    const lists = el.querySelectorAll('ul');
    const burger = lists[0].querySelector('[data-id="b"]') as HTMLElement;
    lists[1].appendChild(burger);
    i.syncSignalsWithDOM();
    expect(i.linkedProducts().map((p) => [p.id, p.type])).toEqual([
      ['a', AddOnTypeEnum.Sauce],
      ['b', AddOnTypeEnum.Topping],
    ]);
    expect(i.availableProducts().map((p) => p.id)).toEqual(['c', 'z']);
  });

  it('syncs removal of a linked product back to available', () => {
    const { i, el } = setup();
    const lists = el.querySelectorAll('ul');
    lists[0].appendChild(lists[1].querySelector('[data-id="a"]') as HTMLElement);
    i.syncSignalsWithDOM();
    expect(i.linkedProducts()).toHaveLength(0);
    expect(i.availableProducts().map((p) => p.name)).toEqual([
      'Americano',
      'Burger',
      'Coffee',
      'Zucchini',
    ]);
  });

  it('saves linked products and closes the modal', () => {
    const { i } = setup();
    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    i.saveProducts();
    expect(products.assignLinkedProducts).toHaveBeenCalledWith('ao1', [
      { productId: 'a', addOnType: AddOnTypeEnum.Flavor },
    ]);
    expect(alerts.successSaved).toHaveBeenCalledWith('Linked products');
    expect(modal.close).toHaveBeenCalled();
    expect(i.isSaving()).toBe(false);
  });

  it('reports save errors', () => {
    products.assignLinkedProducts.mockReturnValue(throwError(() => new Error('bad')));
    const { i } = setup();
    i.saveProducts();
    expect(alerts.error).toHaveBeenCalledWith('bad');
    expect(i.isSaving()).toBe(false);
  });

  it('blocks closing while saving', () => {
    products.assignLinkedProducts.mockReturnValue(new Subject());
    const { i } = setup();
    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    i.saveProducts();
    i.closeModal();
    expect(modal.close).not.toHaveBeenCalled();
  });

  it('registers on and removes from the modal stack', () => {
    const { fixture, i } = setup();
    const modal = document.querySelector('#products-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    fixture.componentInstance.registerOnStack();
    i.closeModal();
    expect(stack.remove).toHaveBeenCalledWith(9);
    i.closeModal();
    expect(stack.remove).toHaveBeenCalledTimes(1);
  });
});
