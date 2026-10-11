import { TestBed } from '@angular/core/testing';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AddOnGroupDto, AddOnTypeEnum, ProductCategoryEnum, ProductDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddonsSwapperComponent } from './addons-swapper';

interface Internals {
  availableAddOns: () => (ProductDto & { type: AddOnTypeEnum })[];
  assignedAddOns: () => (ProductDto & { type: AddOnTypeEnum })[];
  filteredAvailableAddOns(): ProductDto[];
  searchTerm(): string;
  isLoading(): boolean;
  isSaving(): boolean;
  saveAddOns(): void;
  closeModal(): void;
  onSearchInput(e: unknown): void;
  changeAddOnType(id: string, e: unknown): void;
  syncSignalsWithDOM(): void;
}

function addon(id: string, name: string, price = 5): ProductDto {
  return {
    id,
    name,
    code: id.toUpperCase(),
    price,
    category: ProductCategoryEnum.Other,
    isAddOn: true,
    isActive: true,
    createdAt: '',
    createdBy: '',
    priceHistory: [],
    addOnCount: 0,
  };
}

describe('AddonsSwapperComponent', () => {
  let products: {
    getProducts: ReturnType<typeof vi.fn>;
    getProductAddOns: ReturnType<typeof vi.fn>;
    assignProductAddOns: ReturnType<typeof vi.fn>;
  };
  let alerts: { error: ReturnType<typeof vi.fn>; successSaved: ReturnType<typeof vi.fn> };
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  const all = [addon('z', 'Zebra'), addon('b', 'Bacon'), addon('c', 'Cheese'), addon('a', 'Apple')];
  const groups: AddOnGroupDto[] = [
    { type: AddOnTypeEnum.Sauce, displayName: 'Sauce', options: [addon('c', 'Cheese')] },
    { type: AddOnTypeEnum.Extra, displayName: 'Extra', options: [addon('a', 'Apple')] },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    products = {
      getProducts: vi.fn().mockReturnValue(of(all)),
      getProductAddOns: vi.fn().mockReturnValue(of(groups)),
      assignProductAddOns: vi.fn().mockReturnValue(of(undefined)),
    };
    alerts = { error: vi.fn(), successSaved: vi.fn() };
    stack = { push: vi.fn().mockReturnValue(3), remove: vi.fn() };
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

  function setup(productId = 'p1') {
    const fixture = TestBed.createComponent(AddonsSwapperComponent);
    fixture.componentInstance.productId = productId;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const i = fixture.componentInstance as unknown as Internals;
    return { fixture, i, el: fixture.nativeElement as HTMLElement };
  }

  it('smoke renders the modal title and buttons without loading when no productId', () => {
    const { el } = setup('');
    expect(el.textContent).toContain('Manage Product Add-ons');
    expect(el.textContent).toContain('Save Add-ons');
    expect(products.getProducts).not.toHaveBeenCalled();
  });

  it('loads add-ons and splits available vs assigned, sorted by name', () => {
    const { fixture, i, el } = setup();
    fixture.detectChanges();
    expect(products.getProducts).toHaveBeenCalledWith({ isAddOn: true, isActive: true });
    expect(products.getProductAddOns).toHaveBeenCalledWith('p1');
    expect(i.availableAddOns().map((a) => a.name)).toEqual(['Bacon', 'Zebra']);
    expect(i.assignedAddOns().map((a) => [a.name, a.type])).toEqual([
      ['Apple', AddOnTypeEnum.Extra],
      ['Cheese', AddOnTypeEnum.Sauce],
    ]);
    expect(i.availableAddOns().every((a) => a.type === AddOnTypeEnum.Size)).toBe(true);
    expect(i.isLoading()).toBe(false);
    expect(el.querySelectorAll('li[data-id]')).toHaveLength(4);
  });

  it('initializes sortable lists after a delay without throwing', () => {
    setup();
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });

  it('shows an error and stops loading when fetching add-ons fails', () => {
    products.getProducts.mockReturnValue(throwError(() => new Error('boom')));
    const { i } = setup();
    expect(alerts.error).toHaveBeenCalledWith('boom');
    expect(i.isLoading()).toBe(false);
  });

  it('shows an error when fetching assigned add-ons fails', () => {
    products.getProductAddOns.mockReturnValue(throwError(() => new Error('nope')));
    const { i } = setup();
    expect(alerts.error).toHaveBeenCalledWith('nope');
    expect(i.isLoading()).toBe(false);
  });

  it('shows the loading state while requests are pending', () => {
    products.getProducts.mockReturnValue(new Subject());
    const { i, fixture } = setup();
    fixture.detectChanges();
    expect(i.isLoading()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading-lg')).toBeTruthy();
  });

  it('filters available add-ons by trimmed case-insensitive term', () => {
    const { i, fixture } = setup();
    i.onSearchInput({ target: { value: '  ZEB ' } });
    fixture.detectChanges();
    expect(i.filteredAvailableAddOns().map((a) => a.name)).toEqual(['Zebra']);
    i.onSearchInput({ target: { value: 'nothing' } });
    fixture.detectChanges();
    expect(i.filteredAvailableAddOns()).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No matches');
  });

  it('changes the type of an assigned add-on only', () => {
    const { i } = setup();
    i.changeAddOnType('c', { target: { value: '3' } });
    const byId = new Map(i.assignedAddOns().map((a) => [a.id, a.type]));
    expect(byId.get('c')).toBe(AddOnTypeEnum.Topping);
    expect(byId.get('a')).toBe(AddOnTypeEnum.Extra);
  });

  it('syncs signals from the DOM after a drag between lists', () => {
    const { i, el, fixture } = setup();
    const lists = el.querySelectorAll('ul');
    const available = lists[0];
    const assigned = lists[1];
    const bacon = available.querySelector('[data-id="b"]') as HTMLElement;
    const apple = assigned.querySelector('[data-id="a"]') as HTMLElement;
    // Move bacon into assigned (before apple) and apple to available
    assigned.insertBefore(bacon, assigned.firstChild);
    available.appendChild(apple);
    i.syncSignalsWithDOM();
    expect(i.assignedAddOns().map((a) => a.id)).toEqual(['b', 'c']);
    expect(i.availableAddOns().map((a) => a.name)).toEqual(['Apple', 'Zebra']);
    expect(fixture).toBeTruthy();
  });

  it('saves the assigned add-ons with their types, then closes the modal', () => {
    const { i } = setup();
    const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    i.saveAddOns();
    expect(products.assignProductAddOns).toHaveBeenCalledWith('p1', [
      { addOnId: 'a', addOnType: AddOnTypeEnum.Extra },
      { addOnId: 'c', addOnType: AddOnTypeEnum.Sauce },
    ]);
    expect(alerts.successSaved).toHaveBeenCalledWith('Product add-ons');
    expect(i.isSaving()).toBe(false);
    expect(modal.close).toHaveBeenCalled();
  });

  it('reports save errors and resets saving flag', () => {
    products.assignProductAddOns.mockReturnValue(throwError(() => new Error('fail')));
    const { i } = setup();
    i.saveAddOns();
    expect(alerts.error).toHaveBeenCalledWith('fail');
    expect(i.isSaving()).toBe(false);
  });

  it('does not close while saving', () => {
    products.assignProductAddOns.mockReturnValue(new Subject());
    const { i } = setup();
    const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    i.saveAddOns();
    expect(i.isSaving()).toBe(true);
    i.closeModal();
    expect(modal.close).not.toHaveBeenCalled();
  });

  it('registers on the modal stack and removes itself when closed', () => {
    const { fixture, i } = setup();
    const modal = document.querySelector('#addons-swapper-modal') as HTMLDialogElement;
    modal.close = vi.fn();
    fixture.componentInstance.registerOnStack();
    expect(stack.push).toHaveBeenCalledTimes(1);
    i.closeModal();
    expect(stack.remove).toHaveBeenCalledWith(3);
    i.closeModal();
    expect(stack.remove).toHaveBeenCalledTimes(1);
    // the registered callback closes the modal
    (stack.push.mock.calls[0][0] as () => void)();
    expect(modal.close).toHaveBeenCalled();
  });
});
