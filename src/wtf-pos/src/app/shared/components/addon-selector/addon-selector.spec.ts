import { TestBed } from '@angular/core/testing';
import { CatalogCacheService, ModalStackService } from '@core/services';
import {
  AddOnGroupDto,
  AddOnTypeEnum,
  CartAddOnDto,
  ProductCategoryEnum,
  ProductDto,
} from '@shared/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddonSelectorComponent } from './addon-selector';

type Group = AddOnGroupDto;

interface Internals {
  isOpen(): boolean;
  productQuantity(): number;
  validationError(): string | null;
  selectedAddOns(): CartAddOnDto[];
  addOnTotal(): number;
  unitPrice(): number;
  totalPrice(): number;
  activePromoLabel(): string | null;
  selections(): Record<number, Map<string, number>>;
  addOnGroups(): Group[];
  specialInstructions(): string;
  getSelectionRule(t: AddOnTypeEnum): string;
  getGroupHeader(g: Group): string;
  isRadioGroup(t: AddOnTypeEnum): boolean;
  isSelected(t: AddOnTypeEnum, id: string): boolean;
  getQuantity(t: AddOnTypeEnum, id: string): number;
  toggleOption(g: Group, o: ProductDto): void;
  incrementOption(g: Group, o: ProductDto, e: Event): void;
  decrementOption(g: Group, o: ProductDto, e: Event): void;
  canIncrementOption(g: Group, id: string): boolean;
  onSpecialInstructionsInput(e: unknown): void;
  incrementProductQuantity(e: Event): void;
  decrementProductQuantity(e: Event): void;
  confirm(): void;
  close(): void;
}

function prod(id: string, name: string, price: number, isActive = true): ProductDto {
  return {
    id,
    name,
    code: id,
    price,
    category: ProductCategoryEnum.Drink,
    isAddOn: true,
    isActive,
    createdAt: '',
    createdBy: '',
    priceHistory: [],
    addOnCount: 0,
  };
}

const evt = () => ({ stopPropagation: vi.fn() }) as unknown as Event;

const SMALL = prod('s', 'Small', 0);
const LARGE = prod('l', 'Large', 20);
const VANILLA = prod('v', 'Vanilla', 5);
const CHOC = prod('c', 'Choc', 7);
const BOBA = prod('b', 'Boba', 10);
const CHEESE = { ...prod('ch', 'Cheese', 15), overridePrice: 12 };
const GONE = prod('g', 'Gone', 1, false);
const MAIN = prod('main', 'Latte', 100);

const sizeG: Group = { type: AddOnTypeEnum.Size, displayName: 'Size', options: [LARGE, SMALL] };
const flavorG: Group = { type: AddOnTypeEnum.Flavor, displayName: 'Flavor', options: [CHOC, VANILLA] };
const toppingG: Group = {
  type: AddOnTypeEnum.Topping,
  displayName: 'Topping',
  options: [BOBA, CHEESE, GONE],
};
const sauceG: Group = { type: AddOnTypeEnum.Sauce, displayName: 'Sauce', options: [VANILLA] };

describe('AddonSelectorComponent', () => {
  let cache: { getAddOnsForProduct: ReturnType<typeof vi.fn> };
  let stack: { push: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cache = { getAddOnsForProduct: vi.fn().mockReturnValue([]) };
    stack = { push: vi.fn().mockReturnValue(5), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogCacheService, useValue: cache },
        { provide: ModalStackService, useValue: stack },
      ],
    });
  });

  function setup(groups: Group[] = [toppingG, flavorG, sizeG]) {
    cache.getAddOnsForProduct.mockReturnValue(groups.map((g) => ({ ...g, options: [...g.options] })));
    const fixture = TestBed.createComponent(AddonSelectorComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const i = cmp as unknown as Internals;
    const added = vi.fn();
    cmp.addToCart.subscribe(added);
    return { fixture, cmp, i, added, el: fixture.nativeElement as HTMLElement };
  }

  describe('open / render', () => {
    it('renders nothing until opened, then renders groups sorted by type order', () => {
      const { fixture, cmp, i, el } = setup();
      expect(el.textContent?.trim()).toBe('');
      cmp.open(MAIN);
      fixture.detectChanges();
      expect(i.isOpen()).toBe(true);
      expect(i.addOnGroups().map((g) => g.type)).toEqual([
        AddOnTypeEnum.Size,
        AddOnTypeEnum.Flavor,
        AddOnTypeEnum.Topping,
      ]);
      expect(el.textContent).toContain('Latte');
      expect(el.textContent).toContain('Sizes');
      expect(el.textContent).toContain('Please select a size to continue.');
      expect(stack.push).toHaveBeenCalledTimes(1);
    });

    it('does not reorder the cached add-on groups it was given', () => {
      const cached = [toppingG, flavorG, sizeG].map((g) => ({ ...g, options: [...g.options] }));
      const before = cached.map((g) => g.type);
      const { cmp } = setup([]);
      cache.getAddOnsForProduct.mockReturnValue(cached);
      cmp.open(MAIN);
      expect(cached.map((g) => g.type)).toEqual(before);
    });

    it('sorts options by name and removes duplicates', () => {
      const dup: Group = { ...sizeG, options: [LARGE, SMALL, LARGE] };
      const { cmp, i } = setup([dup]);
      cmp.open(MAIN);
      expect(i.addOnGroups()[0].options.map((o) => o.name)).toEqual(['Large', 'Small']);
    });

    it('clamps initial quantity into 1..99', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, { quantity: 500 });
      expect(i.productQuantity()).toBe(99);
      cmp.open(MAIN, { quantity: -3 });
      expect(i.productQuantity()).toBe(1);
    });

    it('restores initial add-ons using addOnType or the option lookup', () => {
      const { cmp, i } = setup([sizeG, toppingG]);
      cmp.open(MAIN, {
        addOns: [
          { addOnId: 'l', name: 'Large', price: 20 },
          { addOnId: 'b', name: 'Boba', price: 10, addOnType: AddOnTypeEnum.Topping },
          { addOnId: 'b', name: 'Boba', price: 10, addOnType: AddOnTypeEnum.Topping },
          { addOnId: 'unknown', name: '?', price: 1 },
        ],
        specialInstructions: 'less ice',
        editIndex: 2,
      });
      expect(i.getQuantity(AddOnTypeEnum.Size, 'l')).toBe(1);
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(2);
      expect(i.specialInstructions()).toBe('less ice');
      expect(i.validationError()).toBeNull();
    });

    it('shows the empty message when the product has no add-ons', () => {
      const { fixture, cmp, el } = setup([]);
      cmp.open(MAIN);
      fixture.detectChanges();
      expect(el.querySelector('textarea')).toBeTruthy();
    });

    it('close resets state and removes from modal stack', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN, { quantity: 3 });
      i.close();
      expect(i.isOpen()).toBe(false);
      expect(i.productQuantity()).toBe(1);
      expect(i.addOnGroups()).toEqual([]);
      expect(stack.remove).toHaveBeenCalledWith(5);
      i.close();
      expect(stack.remove).toHaveBeenCalledTimes(1);
    });

    it('modal stack callback closes the selector', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      (stack.push.mock.calls[0][0] as () => void)();
      expect(i.isOpen()).toBe(false);
    });
  });

  describe('selection rules', () => {
    it('labels groups and rules', () => {
      const { i } = setup();
      expect(i.getGroupHeader(sizeG)).toBe('Sizes');
      expect(i.getGroupHeader(flavorG)).toBe('Flavors');
      expect(i.getGroupHeader(sauceG)).toBe('Sauces');
      expect(i.getGroupHeader(toppingG)).toBe('Toppings');
      expect(i.getGroupHeader({ type: 99 as AddOnTypeEnum, displayName: 'Dip', options: [] })).toBe(
        'Dips',
      );
      expect(i.getGroupHeader({ type: 99 as AddOnTypeEnum, displayName: 'Dips', options: [] })).toBe(
        'Dips',
      );
      expect(i.getSelectionRule(AddOnTypeEnum.Size)).toBe('Required · Pick one');
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe('Optional · Pick many');
      expect(i.getSelectionRule(99 as AddOnTypeEnum)).toBe('');
      expect(i.isRadioGroup(AddOnTypeEnum.Sauce)).toBe(true);
      expect(i.isRadioGroup(AddOnTypeEnum.Topping)).toBe(false);
    });

    it('radio groups select one at a time and cannot deselect size', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.toggleOption(sizeG, SMALL);
      i.toggleOption(sizeG, LARGE);
      expect(i.isSelected(AddOnTypeEnum.Size, 'l')).toBe(true);
      expect(i.isSelected(AddOnTypeEnum.Size, 's')).toBe(false);
      i.toggleOption(sizeG, LARGE);
      expect(i.isSelected(AddOnTypeEnum.Size, 'l')).toBe(true);
    });

    it('sauce can be deselected and allows at most one', () => {
      const { cmp, i } = setup([sauceG]);
      cmp.open(MAIN);
      i.toggleOption(sauceG, VANILLA);
      expect(i.isSelected(AddOnTypeEnum.Sauce, 'v')).toBe(true);
      i.toggleOption(sauceG, VANILLA);
      expect(i.isSelected(AddOnTypeEnum.Sauce, 'v')).toBe(false);
    });

    it('sauce group with more than one selection is invalid', () => {
      const { cmp, i } = setup([sauceG]);
      cmp.open(MAIN);
      i.incrementOption(sauceG, VANILLA, evt());
      i.incrementOption(sauceG, VANILLA, evt());
      expect(i.validationError()).toBe('You can select at most one sauce.');
    });

    it('multi-select toggles on, then reduces/removes quantity on subsequent clicks', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.toggleOption(toppingG, BOBA);
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(1);
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(2);
      i.toggleOption(toppingG, BOBA);
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(1);
      i.toggleOption(toppingG, BOBA);
      expect(i.isSelected(AddOnTypeEnum.Topping, 'b')).toBe(false);
    });

    it('decrement removes at qty 1 and never goes negative', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.incrementOption(toppingG, BOBA, evt());
      i.decrementOption(toppingG, BOBA, evt());
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(0);
      i.decrementOption(toppingG, BOBA, evt());
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(0);
    });

    it('ignores inactive options', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.toggleOption(toppingG, GONE);
      i.incrementOption(toppingG, GONE, evt());
      expect(i.isSelected(AddOnTypeEnum.Topping, 'g')).toBe(false);
    });

    it('stops event propagation for increment/decrement', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      const e = evt();
      i.incrementOption(toppingG, BOBA, e);
      i.decrementOption(toppingG, BOBA, e);
      expect(e.stopPropagation).toHaveBeenCalledTimes(2);
    });

    it('requires exactly one size and one flavor', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      expect(i.validationError()).toBe('Please select a size to continue.');
      i.toggleOption(sizeG, SMALL);
      expect(i.validationError()).toBe('Please select a flavor to continue.');
      i.toggleOption(flavorG, CHOC);
      expect(i.validationError()).toBeNull();
    });

    it('does not require a size group with only inactive options', () => {
      const g: Group = { ...sizeG, options: [GONE] };
      const { cmp, i } = setup([g]);
      cmp.open(MAIN);
      expect(i.validationError()).toBeNull();
    });
  });

  describe('pricing', () => {
    it('adds add-on prices (using overridePrice when set) to the unit price', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.toggleOption(sizeG, LARGE);
      i.toggleOption(flavorG, VANILLA);
      i.incrementOption(toppingG, CHEESE, evt());
      i.incrementOption(toppingG, CHEESE, evt());
      expect(i.addOnTotal()).toBe(20 + 5 + 24);
      expect(i.unitPrice()).toBe(149);
      i.incrementProductQuantity(evt());
      expect(i.totalPrice()).toBe(298);
    });

    it('expands add-ons per quantity in selectedAddOns', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.incrementOption(toppingG, BOBA, evt());
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.selectedAddOns()).toHaveLength(2);
      expect(i.selectedAddOns()[0]).toEqual({
        addOnId: 'b',
        name: 'Boba',
        price: 10,
        addOnType: AddOnTypeEnum.Topping,
      });
    });

    it('clamps product quantity between 1 and 99', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN);
      i.decrementProductQuantity(evt());
      expect(i.productQuantity()).toBe(1);
      cmp.open(MAIN, { quantity: 99 });
      i.incrementProductQuantity(evt());
      expect(i.productQuantity()).toBe(99);
    });

    it('standard mode does not scale selections with quantity', () => {
      const { cmp, i } = setup();
      cmp.open(MAIN);
      i.incrementOption(toppingG, BOBA, evt());
      i.incrementProductQuantity(evt());
      expect(i.getQuantity(AddOnTypeEnum.Topping, 'b')).toBe(1);
    });

    it('flags a negative final price', () => {
      const cheap = { ...MAIN, price: 1 };
      const { cmp, i } = setup([]);
      cmp.open(cheap, {
        customGroups: [{ type: AddOnTypeEnum.Extra, displayName: 'Extra', options: [prod('n', 'Neg', -5)] }],
      });
      i.incrementOption(i.addOnGroups()[0], prod('n', 'Neg', -5), evt());
      expect(i.validationError()).toBe('The final item price cannot be negative.');
    });
  });

  describe('promo rules', () => {
    const flavorOnly = (id: string) => [{ addOnProductId: id, quantity: 1 }];

    it('applies a fixed discount to the base price when add-ons match exactly', () => {
      const { cmp, i } = setup([toppingG]);
      cmp.open(MAIN, {
        promoLabel: 'Deal',
        promoRules: [{ fixedPrice: 30, addOns: flavorOnly('b') }],
      });
      expect(i.unitPrice()).toBe(100);
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.unitPrice()).toBe(70 + 10);
      expect(i.activePromoLabel()).toMatch(/^Promo -₱30\.00$/);
    });

    it('applies the best percent discount and formats the label', () => {
      const { cmp, i } = setup([toppingG]);
      cmp.open(MAIN, {
        promoRules: [
          { percentOff: 10, addOns: flavorOnly('b') },
          { percentOff: 25.5, addOns: flavorOnly('b') },
        ],
      });
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.unitPrice()).toBeCloseTo(74.5 + 10, 5);
      expect(i.activePromoLabel()).toBe('Promo -25.5%');
    });

    it('does not apply when extra add-ons are selected or quantity differs', () => {
      const { cmp, i } = setup([toppingG]);
      cmp.open(MAIN, { promoRules: [{ fixedPrice: 30, addOns: flavorOnly('b') }] });
      i.incrementOption(toppingG, BOBA, evt());
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.activePromoLabel()).toBeNull();
      i.decrementOption(toppingG, BOBA, evt());
      i.incrementOption(toppingG, CHEESE, evt());
      expect(i.activePromoLabel()).toBeNull();
    });

    it('never discounts below zero and ignores rules without required add-ons', () => {
      const { cmp, i } = setup([toppingG]);
      cmp.open(MAIN, {
        promoRules: [
          { fixedPrice: 500, addOns: flavorOnly('b') },
          { fixedPrice: 5, addOns: [] },
        ],
      });
      i.incrementOption(toppingG, BOBA, evt());
      expect(i.unitPrice()).toBe(0 + 10);
    });
  });

  describe('custom option mode', () => {
    const customG: Group = {
      type: AddOnTypeEnum.Extra,
      displayName: 'Pick',
      options: [VANILLA, CHOC],
    };

    it('describes the rules', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, { customGroups: [customG] });
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe('Pick many');
      cmp.open(MAIN, { customGroups: [customG], requiredSelectionCount: 3 });
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe('Pick many · Max selected 3');
      cmp.open(MAIN, { customGroups: [customG], maxSelectionPerOption: 2 });
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe('Pick many · Max 2/item');
      cmp.open(MAIN, {
        customGroups: [customG],
        requiredSelectionCount: 3,
        maxSelectionPerOption: 2,
      });
      expect(i.getSelectionRule(AddOnTypeEnum.Extra)).toBe(
        'Pick many · Max selected 3 · Max 2/item',
      );
    });

    it('requires exactly the required count and enforces the max per option', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, {
        customGroups: [customG],
        requiredSelectionCount: 3,
        maxSelectionPerOption: 2,
      });
      expect(i.validationError()).toBe('Select exactly 3 item(s).');
      i.incrementOption(customG, VANILLA, evt());
      i.incrementOption(customG, VANILLA, evt());
      i.incrementOption(customG, VANILLA, evt()); // blocked by max
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'v')).toBe(2);
      expect(i.canIncrementOption(customG, 'v')).toBe(false);
      i.incrementOption(customG, CHOC, evt());
      expect(i.validationError()).toBeNull();
      i.incrementOption(customG, CHOC, evt()); // blocked by total
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'c')).toBe(1);
      expect(i.canIncrementOption(customG, 'c')).toBe(false);
    });

    it('toggleOption in custom mode refuses to exceed the limits', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, { customGroups: [customG], requiredSelectionCount: 1 });
      i.toggleOption(customG, VANILLA);
      i.toggleOption(customG, CHOC);
      expect(i.isSelected(AddOnTypeEnum.Extra, 'c')).toBe(false);
    });

    it('scales required count and selections with product quantity', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, {
        customGroups: [customG],
        requiredSelectionCount: 2,
        scaleRequiredSelectionByQuantity: true,
      });
      i.incrementOption(customG, VANILLA, evt());
      i.incrementOption(customG, CHOC, evt());
      expect(i.validationError()).toBeNull();
      i.incrementProductQuantity(evt());
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'v')).toBe(2);
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'c')).toBe(2);
      expect(i.validationError()).toBeNull();
      i.decrementOption(customG, CHOC, evt());
      expect(i.validationError()).toBe('Select exactly 4 item(s).');
      i.incrementOption(customG, CHOC, evt());
      i.decrementProductQuantity(evt());
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'v')).toBe(1);
      expect(i.getQuantity(AddOnTypeEnum.Extra, 'c')).toBe(1);
    });

    it('rebalances selections when the required limit shrinks without scaling', () => {
      const { cmp, i } = setup([]);
      cmp.open(MAIN, {
        customGroups: [customG],
        requiredSelectionCount: 2,
        scaleRequiredSelectionByQuantity: true,
        quantity: 2,
      });
      for (let n = 0; n < 2; n++) {
        i.incrementOption(customG, VANILLA, evt());
        i.incrementOption(customG, CHOC, evt());
      }
      i.decrementProductQuantity(evt());
      const total =
        i.getQuantity(AddOnTypeEnum.Extra, 'v') + i.getQuantity(AddOnTypeEnum.Extra, 'c');
      expect(total).toBe(2);
    });
  });

  describe('confirm', () => {
    it('does nothing while invalid', () => {
      const { cmp, i, added } = setup();
      cmp.open(MAIN);
      i.confirm();
      expect(added).not.toHaveBeenCalled();
      expect(i.isOpen()).toBe(true);
    });

    it('does nothing without a product', () => {
      const { i, added } = setup([]);
      i.confirm();
      expect(added).not.toHaveBeenCalled();
    });

    it('emits the selection, trimmed instructions and edit index then closes', () => {
      const { cmp, i, added } = setup();
      cmp.open(MAIN, { editIndex: 4, quantity: 2 });
      i.toggleOption(sizeG, SMALL);
      i.toggleOption(flavorG, CHOC);
      i.incrementOption(toppingG, BOBA, evt());
      const ta = document.createElement('textarea');
      ta.value = '  no ice  ';
      i.onSpecialInstructionsInput({ target: ta });
      i.confirm();
      expect(added).toHaveBeenCalledTimes(1);
      const payload = added.mock.calls[0][0];
      expect(payload.product).toBe(MAIN);
      expect(payload.quantity).toBe(2);
      expect(payload.editIndex).toBe(4);
      expect(payload.specialInstructions).toBe('no ice');
      expect(payload.addOns.map((a: CartAddOnDto) => a.addOnId)).toEqual(['s', 'c', 'b']);
      expect(i.isOpen()).toBe(false);
    });

    it('emits null instructions when blank', () => {
      const { cmp, i, added } = setup([]);
      cmp.open(MAIN);
      i.confirm();
      expect(added.mock.calls[0][0].specialInstructions).toBeNull();
      expect(added.mock.calls[0][0].editIndex).toBeNull();
    });

    it('confirm button is wired up in the template', () => {
      const { fixture, cmp, el, added } = setup([]);
      cmp.open(MAIN);
      fixture.detectChanges();
      const buttons = Array.from(el.querySelectorAll('button'));
      const confirmBtn = buttons[buttons.length - 1];
      expect(confirmBtn.disabled).toBe(false);
      confirmBtn.click();
      expect(added).toHaveBeenCalledTimes(1);
    });
  });
});
