import { TestBed } from '@angular/core/testing';
import { AlertService, ModalStackService, ProductService } from '@core/services';
import { AddOnGroupDto, AddOnTypeEnum, ProductCategoryEnum, ProductDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BundleItemSelection, BundleItemsSelectorComponent } from './bundle-items-selector';

type Group = AddOnGroupDto;

interface Internals {
  isOpen(): boolean;
  isLoadingAddOns(): boolean;
  availableProducts(): ProductDto[];
  selectedProducts(): ProductDto[];
  filteredAvailableProducts(): ProductDto[];
  activeProduct(): ProductDto | null;
  activeSelectedProductId(): string | null;
  activeAddOnGroups(): Group[];
  activeValidationError(): string | null;
  addOnGroupsByProductId(): Record<string, Group[]>;
  close(): void;
  save(): void;
  onSearchInput(e: unknown): void;
  setActiveProduct(id: string): void;
  getSelectionRule(t: AddOnTypeEnum): string;
  getGroupHeader(g: Group): string;
  isRadioGroup(t: AddOnTypeEnum): boolean;
  isSelected(p: string, t: AddOnTypeEnum, o: string): boolean;
  getQuantity(p: string, t: AddOnTypeEnum, o: string): number;
  toggleOption(p: string, g: Group, o: ProductDto): void;
  incrementOption(p: string, g: Group, o: ProductDto, e: Event): void;
  decrementOption(p: string, g: Group, o: ProductDto, e: Event): void;
  getSelectedAddOnCount(p: string): number;
  syncWithDom(): void;
}

function prod(id: string, name: string, isActive = true): ProductDto {
  return {
    id,
    name,
    code: id,
    price: 10,
    category: ProductCategoryEnum.Food,
    isAddOn: false,
    isActive,
    createdAt: '',
    createdBy: '',
    priceHistory: [],
    addOnCount: 0,
  };
}

const evt = () => ({ stopPropagation: vi.fn() }) as unknown as Event;

const P1 = prod('p1', 'Burger');
const P2 = prod('p2', 'Fries');
const P3 = prod('p3', 'Apple Pie');
const SMALL = prod('s', 'Small');
const LARGE = prod('l', 'Large');
const MAYO = prod('m', 'Mayo');
const KETCH = prod('k', 'Ketchup');
const CHEESE = prod('c', 'Cheese');
const GONE = prod('g', 'Gone', false);

const sizeG = (): Group => ({
  type: AddOnTypeEnum.Size,
  displayName: 'Size',
  options: [LARGE, SMALL, LARGE],
});
const sauceG = (): Group => ({
  type: AddOnTypeEnum.Sauce,
  displayName: 'Sauce',
  options: [MAYO, KETCH],
});
const toppingG = (): Group => ({
  type: AddOnTypeEnum.Topping,
  displayName: 'Topping',
  options: [CHEESE, GONE],
});

describe('BundleItemsSelectorComponent', () => {
  let service: { getProductAddOns: ReturnType<typeof vi.fn> };
  let alerts: { error: ReturnType<typeof vi.fn> };
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    service = { getProductAddOns: vi.fn().mockReturnValue(of([])) };
    alerts = { error: vi.fn() };
    stack = { push: vi.fn().mockReturnValue(11), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProductService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: ModalStackService, useValue: stack },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(BundleItemsSelectorComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const i = cmp as unknown as Internals;
    const confirmed = vi.fn<(r: BundleItemSelection[]) => void>();
    cmp.confirmed.subscribe(confirmed);
    return { fixture, cmp, i, confirmed, el: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing when closed and a dialog after open (smoke)', () => {
    const { fixture, cmp, el } = setup();
    expect(el.querySelector('li')).toBeNull();
    cmp.open([P1, P2], []);
    fixture.detectChanges();
    expect(el.textContent).toContain('Burger');
    expect(el.textContent).toContain('Fries');
  });

  describe('open', () => {
    it('splits products into selected (in given order) and available (sorted)', () => {
      const { cmp, i } = setup();
      cmp.open([P1, P2, P3], [{ productId: 'p2', addOns: [] }]);
      expect(i.selectedProducts().map((p) => p.id)).toEqual(['p2']);
      expect(i.availableProducts().map((p) => p.name)).toEqual(['Apple Pie', 'Burger']);
      expect(i.activeSelectedProductId()).toBe('p2');
      expect(i.activeProduct()).toBe(P2);
      expect(stack.push).toHaveBeenCalledTimes(1);
    });

    it('ignores selected items not present in the product list', () => {
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'missing', addOns: [] }]);
      expect(i.selectedProducts()).toEqual([]);
      expect(i.activeSelectedProductId()).toBeNull();
      expect(i.activeProduct()).toBeNull();
      expect(i.activeValidationError()).toBeNull();
      expect(service.getProductAddOns).not.toHaveBeenCalled();
    });

    it('loads add-ons for the first selected product and restores initial selections', () => {
      service.getProductAddOns.mockReturnValue(of([sauceG(), sizeG()]));
      const { cmp, i } = setup();
      cmp.open(
        [P1],
        [
          {
            productId: 'p1',
            addOns: [
              { addOnProductId: 'l', quantity: 1 },
              { addOnProductId: 'm', quantity: 0 },
              { addOnProductId: 'zzz', quantity: 1 },
            ],
          },
        ],
      );
      expect(service.getProductAddOns).toHaveBeenCalledWith('p1');
      expect(i.activeAddOnGroups().map((g) => g.type)).toEqual([
        AddOnTypeEnum.Size,
        AddOnTypeEnum.Sauce,
      ]);
      // deduped + sorted
      expect(i.activeAddOnGroups()[0].options.map((o) => o.name)).toEqual(['Large', 'Small']);
      expect(i.getQuantity('p1', AddOnTypeEnum.Size, 'l')).toBe(1);
      // quantity 0 falls back to 1
      expect(i.getQuantity('p1', AddOnTypeEnum.Sauce, 'm')).toBe(1);
      expect(i.isLoadingAddOns()).toBe(false);
    });

    it('treats add-on load failure as no groups', () => {
      service.getProductAddOns.mockReturnValue(throwError(() => new Error('x')));
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      expect(i.activeAddOnGroups()).toEqual([]);
      expect(i.isLoadingAddOns()).toBe(false);
    });

    it('shows loading while the request is pending', () => {
      service.getProductAddOns.mockReturnValue(new Subject());
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      expect(i.isLoadingAddOns()).toBe(true);
    });

    it('initializes sortable after a delay without throwing', () => {
      const { fixture, cmp } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }]);
      fixture.detectChanges();
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });
  });

  describe('search', () => {
    it('filters available products case-insensitively', () => {
      const { cmp, i } = setup();
      cmp.open([P1, P2, P3], []);
      i.onSearchInput({ target: { value: '  FRI ' } });
      expect(i.filteredAvailableProducts().map((p) => p.id)).toEqual(['p2']);
      i.onSearchInput({ target: { value: '' } });
      expect(i.filteredAvailableProducts()).toHaveLength(3);
    });
  });

  describe('option selection', () => {
    it('describes rules and headers', () => {
      const { i } = setup();
      expect(i.getSelectionRule(AddOnTypeEnum.Size)).toBe('Required | Pick one');
      expect(i.getSelectionRule(AddOnTypeEnum.Sauce)).toBe('Optional | Pick one');
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe('Optional | Pick many');
      expect(i.getSelectionRule(0 as AddOnTypeEnum)).toBe('');
      expect(i.getGroupHeader(sizeG())).toBe('Sizes');
      expect(i.getGroupHeader(toppingG())).toBe('Toppings');
      expect(i.getGroupHeader({ type: 9 as AddOnTypeEnum, displayName: 'Dip', options: [] })).toBe(
        'Dips',
      );
      expect(i.isRadioGroup(AddOnTypeEnum.Flavor)).toBe(true);
      expect(i.isRadioGroup(AddOnTypeEnum.Extra)).toBe(false);
    });

    it('radio groups switch selection and size cannot be deselected', () => {
      const { i } = setup();
      const g = sizeG();
      i.toggleOption('p1', g, SMALL);
      i.toggleOption('p1', g, LARGE);
      expect(i.isSelected('p1', AddOnTypeEnum.Size, 's')).toBe(false);
      expect(i.isSelected('p1', AddOnTypeEnum.Size, 'l')).toBe(true);
      i.toggleOption('p1', g, LARGE);
      expect(i.isSelected('p1', AddOnTypeEnum.Size, 'l')).toBe(true);
    });

    it('sauce can be deselected', () => {
      const { i } = setup();
      const g = sauceG();
      i.toggleOption('p1', g, MAYO);
      i.toggleOption('p1', g, MAYO);
      expect(i.isSelected('p1', AddOnTypeEnum.Sauce, 'm')).toBe(false);
    });

    it('multi-select toggles on and off, with increment/decrement quantities', () => {
      const { i } = setup();
      const g = toppingG();
      i.toggleOption('p1', g, CHEESE);
      expect(i.getQuantity('p1', AddOnTypeEnum.Topping, 'c')).toBe(1);
      i.incrementOption('p1', g, CHEESE, evt());
      expect(i.getQuantity('p1', AddOnTypeEnum.Topping, 'c')).toBe(2);
      i.decrementOption('p1', g, CHEESE, evt());
      expect(i.getQuantity('p1', AddOnTypeEnum.Topping, 'c')).toBe(1);
      i.decrementOption('p1', g, CHEESE, evt());
      i.decrementOption('p1', g, CHEESE, evt());
      expect(i.getQuantity('p1', AddOnTypeEnum.Topping, 'c')).toBe(0);
      i.toggleOption('p1', g, CHEESE);
      i.toggleOption('p1', g, CHEESE);
      expect(i.isSelected('p1', AddOnTypeEnum.Topping, 'c')).toBe(false);
    });

    it('ignores inactive options and keeps products isolated', () => {
      const { i } = setup();
      const g = toppingG();
      i.toggleOption('p1', g, GONE);
      i.incrementOption('p1', g, GONE, evt());
      expect(i.isSelected('p1', AddOnTypeEnum.Topping, 'g')).toBe(false);
      i.toggleOption('p1', g, CHEESE);
      expect(i.isSelected('p2', AddOnTypeEnum.Topping, 'c')).toBe(false);
    });

    it('counts selected add-ons across the loaded groups', () => {
      service.getProductAddOns.mockReturnValue(of([sizeG(), toppingG()]));
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      const [size, topping] = i.activeAddOnGroups();
      i.toggleOption('p1', size, SMALL);
      i.incrementOption('p1', topping, CHEESE, evt());
      expect(i.getSelectedAddOnCount('p1')).toBe(2);
      expect(i.getSelectedAddOnCount('unknown')).toBe(0);
    });
  });

  describe('validation', () => {
    it('requires exactly one size for the active product', () => {
      service.getProductAddOns.mockReturnValue(of([sizeG()]));
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      expect(i.activeValidationError()).toBe('Burger requires exactly one size.');
      i.toggleOption('p1', i.activeAddOnGroups()[0], SMALL);
      expect(i.activeValidationError()).toBeNull();
    });

    it('requires a flavor and limits sauce to one', () => {
      service.getProductAddOns.mockReturnValue(
        of([{ type: AddOnTypeEnum.Flavor, displayName: 'Flavor', options: [MAYO] }, sauceG()]),
      );
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      expect(i.activeValidationError()).toBe('Burger requires exactly one flavor.');
      const [flavor, sauce] = i.activeAddOnGroups();
      i.toggleOption('p1', flavor, MAYO);
      i.incrementOption('p1', sauce, MAYO, evt());
      i.incrementOption('p1', sauce, KETCH, evt());
      expect(i.activeValidationError()).toBe('Burger allows only one sauce.');
    });

    it('skips size validation when all size options are inactive', () => {
      service.getProductAddOns.mockReturnValue(
        of([{ type: AddOnTypeEnum.Size, displayName: 'Size', options: [GONE] }]),
      );
      const { cmp, i } = setup();
      cmp.open([P1], [{ productId: 'p1', addOns: [] }]);
      expect(i.activeValidationError()).toBeNull();
    });
  });

  describe('save', () => {
    it('emits all selected products with flattened add-ons and closes', () => {
      service.getProductAddOns.mockImplementation((id: string) =>
        of(id === 'p1' ? [sizeG(), toppingG()] : []),
      );
      const { cmp, i, confirmed } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }, { productId: 'p2', addOns: [] }]);
      const [size, topping] = i.activeAddOnGroups();
      i.toggleOption('p1', size, SMALL);
      i.incrementOption('p1', topping, CHEESE, evt());
      i.incrementOption('p1', topping, CHEESE, evt());
      i.save();
      expect(confirmed).toHaveBeenCalledWith([
        {
          productId: 'p1',
          addOns: [
            { addOnProductId: 's', quantity: 1 },
            { addOnProductId: 'c', quantity: 2 },
          ],
        },
        { productId: 'p2', addOns: [] },
      ]);
      expect(i.isOpen()).toBe(false);
      expect(stack.remove).toHaveBeenCalledWith(11);
    });

    it('fetches add-ons for products that were never activated before validating', () => {
      service.getProductAddOns.mockImplementation((id: string) =>
        of(id === 'p2' ? [sizeG()] : []),
      );
      const { cmp, i, confirmed } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }, { productId: 'p2', addOns: [] }]);
      i.save();
      expect(service.getProductAddOns).toHaveBeenCalledWith('p2');
      expect(alerts.error).toHaveBeenCalledWith('Fries requires exactly one size.');
      expect(confirmed).not.toHaveBeenCalled();
      expect(i.activeSelectedProductId()).toBe('p2');
      expect(i.isOpen()).toBe(true);
    });

    it('treats a failed add-on fetch during save as no groups', () => {
      service.getProductAddOns.mockImplementation((id: string) =>
        id === 'p2' ? throwError(() => new Error('x')) : of([]),
      );
      const { cmp, i, confirmed } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }, { productId: 'p2', addOns: [] }]);
      i.save();
      expect(confirmed).toHaveBeenCalledTimes(1);
    });

    it('applies initial add-on selections for products loaded at save time', () => {
      service.getProductAddOns.mockImplementation((id: string) =>
        of(id === 'p2' ? [sizeG()] : []),
      );
      const { cmp, i, confirmed } = setup();
      cmp.open(
        [P1, P2],
        [
          { productId: 'p1', addOns: [] },
          { productId: 'p2', addOns: [{ addOnProductId: 'l', quantity: 1 }] },
        ],
      );
      i.save();
      expect(confirmed.mock.calls[0][0][1]).toEqual({
        productId: 'p2',
        addOns: [{ addOnProductId: 'l', quantity: 1 }],
      });
    });

    it('emits an empty list when nothing is selected', () => {
      const { cmp, i, confirmed } = setup();
      cmp.open([P1], []);
      i.save();
      expect(confirmed).toHaveBeenCalledWith([]);
    });
  });

  describe('active product & DOM sync', () => {
    it('setActiveProduct loads groups once', () => {
      const { cmp, i } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }, { productId: 'p2', addOns: [] }]);
      service.getProductAddOns.mockClear();
      i.setActiveProduct('p2');
      i.setActiveProduct('p2');
      expect(i.activeSelectedProductId()).toBe('p2');
      expect(service.getProductAddOns).toHaveBeenCalledTimes(1);
    });

    it('syncs selected/available lists from the DOM order after a drag', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open([P1, P2, P3], [{ productId: 'p1', addOns: [] }]);
      fixture.detectChanges();
      vi.advanceTimersByTime(100);
      const lists = Array.from(el.querySelectorAll('ul'));
      const available = lists.find((u) => u.querySelector('[data-id="p2"]')) as HTMLElement;
      const selected = lists.find((u) => u.querySelector('[data-id="p1"]')) as HTMLElement;
      const fries = available.querySelector('[data-id="p2"]') as HTMLElement;
      selected.insertBefore(fries, selected.firstChild);
      i.syncWithDom();
      expect(i.selectedProducts().map((p) => p.id)).toEqual(['p2', 'p1']);
      expect(i.availableProducts().map((p) => p.id)).toEqual(['p3']);
    });

    it('moves active selection to the first selected product if the active one is removed', () => {
      const { fixture, cmp, i, el } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }, { productId: 'p2', addOns: [] }]);
      fixture.detectChanges();
      vi.advanceTimersByTime(100);
      const lists = Array.from(el.querySelectorAll('ul'));
      const selected = lists.find((u) => u.querySelector('[data-id="p1"]')) as HTMLElement;
      const available = lists.find((u) => u !== selected) as HTMLElement;
      available.appendChild(selected.querySelector('[data-id="p1"]') as HTMLElement);
      i.syncWithDom();
      expect(i.activeSelectedProductId()).toBe('p2');
      expect(i.availableProducts().map((p) => p.id)).toEqual(['p1']);
    });
  });

  describe('close', () => {
    it('resets state and unregisters from the modal stack', () => {
      service.getProductAddOns.mockReturnValue(of([sizeG()]));
      const { cmp, i } = setup();
      cmp.open([P1, P2], [{ productId: 'p1', addOns: [] }]);
      i.close();
      expect(i.isOpen()).toBe(false);
      expect(i.selectedProducts()).toEqual([]);
      expect(i.availableProducts()).toEqual([]);
      expect(i.addOnGroupsByProductId()).toEqual({});
      expect(stack.remove).toHaveBeenCalledWith(11);
      i.close();
      expect(stack.remove).toHaveBeenCalledTimes(1);
    });

    it('is triggered by the modal stack callback', () => {
      const { cmp, i } = setup();
      cmp.open([P1], []);
      (stack.push.mock.calls[0][0] as () => void)();
      expect(i.isOpen()).toBe(false);
    });
  });
});
