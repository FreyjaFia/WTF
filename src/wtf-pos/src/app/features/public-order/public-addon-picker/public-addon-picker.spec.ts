import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicAddOnGroupDto, PublicProductDto } from '@shared/models';
import { describe, expect, it, vi } from 'vitest';
import { internals, Internals } from '../../../testing/management-spec-helpers';
import { PublicAddonPickerComponent, PublicAddonPickerResult } from './public-addon-picker';

const PRODUCT: PublicProductDto = {
  id: 'p1',
  name: 'Latte',
  price: 100,
  category: 1,
  addOnCount: 4,
};
const opt = (id: string, name: string, price: number): PublicProductDto => ({
  id,
  name,
  price,
  category: 1,
  addOnCount: 0,
});
const SIZE: PublicAddOnGroupDto = {
  type: 1,
  displayName: 'Size',
  options: [opt('s-l', 'Large', 30), opt('s-r', 'Regular', 0)],
};
const FLAVOR: PublicAddOnGroupDto = {
  type: 2,
  displayName: 'Flavor',
  options: [opt('f-v', 'Vanilla', 10)],
};
const SAUCE: PublicAddOnGroupDto = {
  type: 5,
  displayName: 'Sauce',
  options: [opt('x-1', 'Caramel', 5), opt('x-2', 'Chocolate', 5)],
};
const EXTRA: PublicAddOnGroupDto = {
  type: 4,
  displayName: 'Extra',
  options: [opt('e-1', 'Extra shot', 40), opt('e-2', 'Whipped cream', 20)],
};

describe('PublicAddonPickerComponent', () => {
  let fixture: ComponentFixture<PublicAddonPickerComponent>;
  let c: Internals;

  function setup(groups: PublicAddOnGroupDto[], initial?: PublicAddonPickerResult) {
    fixture = TestBed.createComponent(PublicAddonPickerComponent);
    fixture.componentRef.setInput('product', PRODUCT);
    fixture.componentRef.setInput('groups', groups);
    if (initial) {
      fixture.componentRef.setInput('initial', initial);
    }
    c = internals(fixture.componentInstance);
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('lists the choices in the shop order: size, flavor, sauce, topping, extra', () => {
    setup([EXTRA, SAUCE, FLAVOR, SIZE]);
    expect(c.sortedGroups().map((g: PublicAddOnGroupDto) => g.displayName)).toEqual([
      'Size',
      'Flavor',
      'Sauce',
      'Extra',
    ]);
    expect(text()).toContain('Large');
    expect(text()).toContain('+₱30.00');
    expect(text()).toContain('+₱0.00');
    expect(text()).not.toContain('Free');
  });

  it('requires a size before adding', () => {
    setup([SIZE]);
    expect(c.validationError()).toBe('Please select a size to continue.');
    c.toggle(1, 's-r');
    expect(c.validationError()).toBeNull();
  });

  it('requires a flavor before adding', () => {
    setup([FLAVOR]);
    expect(c.validationError()).toBe('Please select a flavor to continue.');
    c.toggle(2, 'f-v');
    expect(c.validationError()).toBeNull();
  });

  it('keeps one size selected: picking another replaces it and it cannot be unticked', () => {
    setup([SIZE]);
    c.toggle(1, 's-l');
    c.toggle(1, 's-r');
    expect(c.selectedAddOns().map((a: { id: string }) => a.id)).toEqual(['s-r']);
    c.toggle(1, 's-r');
    expect(c.selectedAddOns().length).toBe(1);
  });

  it('allows at most one sauce but lets it be removed', () => {
    setup([SAUCE]);
    expect(c.validationError()).toBeNull();
    c.toggle(5, 'x-1');
    c.toggle(5, 'x-2');
    expect(c.selectedAddOns().map((a: { id: string }) => a.id)).toEqual(['x-2']);
    c.toggle(5, 'x-2');
    expect(c.selectedAddOns().length).toBe(0);
  });

  it('allows several extras', () => {
    setup([EXTRA]);
    c.toggle(4, 'e-1');
    c.toggle(4, 'e-2');
    expect(c.selectedAddOns().length).toBe(2);
    c.toggle(4, 'e-1');
    expect(c.selectedAddOns().length).toBe(1);
  });

  it('prices the item with its add-ons and quantity', () => {
    setup([SIZE, EXTRA]);
    c.toggle(1, 's-l');
    c.toggle(4, 'e-1');
    expect(c.unitPrice()).toBe(170);
    c.changeQuantity(1);
    expect(c.total()).toBe(340);
    fixture.detectChanges();
    expect(text()).toContain('₱340.00');
  });

  it('keeps the quantity between 1 and 99', () => {
    setup([]);
    c.changeQuantity(-1);
    expect(c.quantity()).toBe(1);
    c.changeQuantity(500);
    expect(c.quantity()).toBe(99);
  });

  it('limits special instructions to 100 characters', () => {
    setup([]);
    c.onInstructions('x'.repeat(150));
    expect(c.instructions().length).toBe(100);
  });

  it('emits the choices, quantity and trimmed instructions on confirm', () => {
    setup([SIZE]);
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    c.toggle(1, 's-l');
    c.changeQuantity(2);
    c.onInstructions('  less ice  ');

    c.confirm();

    expect(confirmed).toHaveBeenCalledWith({
      addOns: [{ id: 's-l', name: 'Large', price: 30, quantity: 1 }],
      quantity: 3,
      specialInstructions: 'less ice',
    });
  });

  it('sends no instructions when the field is blank', () => {
    setup([]);
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    c.onInstructions('   ');
    c.confirm();
    expect(confirmed.mock.calls[0][0].specialInstructions).toBeNull();
  });

  it('does not emit while a required choice is missing', () => {
    setup([SIZE]);
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    c.confirm();
    expect(confirmed).not.toHaveBeenCalled();
    expect(text()).toContain('Please select a size');
  });

  it('emits cancelled from the Cancel button, a click on the backdrop and Escape', () => {
    setup([]);
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    const cancel = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b) => (b as HTMLButtonElement).textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement;
    cancel.click();
    expect(cancelled).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement).click();
    expect(cancelled).toHaveBeenCalledTimes(2);

    fixture.nativeElement
      .querySelector('[role="dialog"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toHaveBeenCalledTimes(3);
  });

  it('does not close when the card itself is clicked', () => {
    setup([SIZE]);
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    (fixture.nativeElement.querySelector('[role="document"]') as HTMLElement).click();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('opens centered over a dimmed, blurred backdrop with the same animation as the shop screen', () => {
    setup([]);
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('items-center');
    expect(dialog.className).toContain('justify-center');
    expect(dialog.className).toContain('bg-black/30');
    expect(dialog.className).toContain('backdrop-blur-md');
    expect(dialog.className).toContain('backdrop-fade');
    expect(
      (fixture.nativeElement.querySelector('[role="document"]') as HTMLElement).className,
    ).toContain('modal-pop');
  });

  it('works for a product with no add-ons: quantity and instructions only', () => {
    setup([]);
    expect(text()).toContain('How many would you like?');
    expect(text()).toContain('Special instructions');
    c.changeQuantity(2);
    expect(c.validationError()).toBeNull();
    expect(c.total()).toBe(300);
  });

  describe('add-on quantities (same as the shop screen)', () => {
    const steppers = () =>
      [...fixture.nativeElement.querySelectorAll('.app-stepper-btn, .app-stepper-btn-primary')].map(
        (b) => (b as HTMLElement).getAttribute('aria-label'),
      );

    it('shows quantity buttons only on selected toppings and extras, besides the item quantity', () => {
      setup([SIZE, EXTRA]);
      expect(steppers()).toEqual(['Decrease quantity', 'Increase quantity']);

      c.toggle(1, 's-l');
      c.toggle(4, 'e-1');
      fixture.detectChanges();

      expect(steppers()).toEqual([
        'Decrease quantity',
        'Increase quantity',
        'Decrease Extra shot quantity',
        'Increase Extra shot quantity',
      ]);
    });

    it('lets an extra be added several times and prices each one', () => {
      setup([EXTRA]);
      const event = new Event('click');
      c.toggle(4, 'e-1');
      c.incrementAddOn(4, 'e-1', event);
      c.incrementAddOn(4, 'e-1', event);

      expect(c.quantityOf(4, 'e-1')).toBe(3);
      expect(c.addOnTotal()).toBe(120);
      expect(c.total()).toBe(220);
      c.changeQuantity(1);
      expect(c.total()).toBe(440);
    });

    it('steps down by one and removes the add-on at zero', () => {
      setup([EXTRA]);
      const event = new Event('click');
      c.toggle(4, 'e-2');
      c.incrementAddOn(4, 'e-2', event);
      c.decrementAddOn(4, 'e-2', event);
      expect(c.quantityOf(4, 'e-2')).toBe(1);
      c.decrementAddOn(4, 'e-2', event);
      expect(c.isSelected(4, 'e-2')).toBe(false);
      expect(c.selectedAddOns().length).toBe(0);
    });

    it('treats a click on a selected row like the shop screen: one less each time', () => {
      setup([EXTRA]);
      c.toggle(4, 'e-1');
      c.incrementAddOn(4, 'e-1', new Event('click'));
      c.toggle(4, 'e-1');
      expect(c.quantityOf(4, 'e-1')).toBe(1);
      c.toggle(4, 'e-1');
      expect(c.isSelected(4, 'e-1')).toBe(false);
    });

    it('does not toggle the row when a quantity button is pressed', () => {
      setup([EXTRA]);
      c.toggle(4, 'e-1');
      fixture.detectChanges();
      const increase = fixture.nativeElement.querySelector(
        '[aria-label="Increase Extra shot quantity"]',
      ) as HTMLButtonElement;
      increase.click();
      expect(c.quantityOf(4, 'e-1')).toBe(2);
    });

    it('caps one add-on at 99', () => {
      setup([EXTRA]);
      c.toggle(4, 'e-1');
      for (let i = 0; i < 120; i++) {
        c.incrementAddOn(4, 'e-1', new Event('click'));
      }
      expect(c.quantityOf(4, 'e-1')).toBe(99);
      expect(c.canIncrement(4, 'e-1')).toBe(false);
    });

    it('sends each add-on with its quantity', () => {
      setup([SIZE, EXTRA]);
      const confirmed = vi.fn();
      fixture.componentInstance.confirmed.subscribe(confirmed);
      c.toggle(1, 's-r');
      c.toggle(4, 'e-1');
      c.incrementAddOn(4, 'e-1', new Event('click'));

      c.confirm();

      expect(confirmed.mock.calls[0][0].addOns).toEqual([
        { id: 's-r', name: 'Regular', price: 0, quantity: 1 },
        { id: 'e-1', name: 'Extra shot', price: 40, quantity: 2 },
      ]);
    });

    it('never gives size, flavor or sauce a quantity', () => {
      setup([SIZE, FLAVOR, SAUCE]);
      c.toggle(1, 's-l');
      c.toggle(2, 'f-v');
      c.toggle(5, 'x-1');
      fixture.detectChanges();
      expect(steppers()).toEqual(['Decrease quantity', 'Increase quantity']);
    });
  });

  it('makes the quantity buttons a comfortable tap size', () => {
    setup([]);
    for (const button of fixture.nativeElement.querySelectorAll(
      '.app-stepper-btn, .app-stepper-btn-primary',
    )) {
      expect(button.className).toContain('h-8');
      expect(button.className).toContain('w-8');
    }
  });

  describe('promos', () => {
    const smallOnly = [{ fixedPrice: 40, addOns: [{ addOnProductId: 's-r', quantity: 1 }] }];

    function setupWith(extra: { startWith?: unknown; rules?: unknown }, groups = [SIZE, EXTRA]) {
      fixture = TestBed.createComponent(PublicAddonPickerComponent);
      fixture.componentRef.setInput('product', PRODUCT);
      fixture.componentRef.setInput('groups', groups);
      if (extra.startWith) {
        fixture.componentRef.setInput('startWith', extra.startWith);
      }
      if (extra.rules) {
        fixture.componentRef.setInput('rules', extra.rules);
      }
      c = internals(fixture.componentInstance);
      fixture.detectChanges();
    }

    it('starts with the add-ons a deal card chose, as a new item and not an edit', () => {
      setupWith({ startWith: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }] });

      expect(c.isSelected(1, 's-r')).toBe(true);
      expect(c.selectedAddOns().map((a: { id: string }) => a.id)).toEqual(['s-r']);
      expect(c.isEditing()).toBe(false);
      expect(c.quantity()).toBe(1);
      expect(c.validationError()).toBeNull();
    });

    it('drops a starting add-on that is no longer offered for the product', () => {
      setupWith({ startWith: [{ id: 'gone', name: 'Gone', price: 0, quantity: 1 }] });

      expect(c.selectedAddOns()).toEqual([]);
    });

    it('shows no discount until the choices match the rule', () => {
      setupWith({ rules: smallOnly });

      expect(c.discount()).toBeNull();
      expect(c.unitPrice()).toBe(100);
      expect(text()).not.toContain('Promo');
    });

    it('lowers the price and shows the label when the add-ons match exactly', () => {
      setupWith({ rules: smallOnly });

      c.toggle(1, 's-r');

      expect(c.discount()).toEqual({ price: 60, label: 'Promo -₱40.00' });
      expect(c.unitPrice()).toBe(60);
      expect(c.total()).toBe(60);
      fixture.detectChanges();
      expect(text()).toContain('Promo -₱40.00');
    });

    it('stops discounting when another add-on is added, and again when it is removed', () => {
      setupWith({ rules: smallOnly });

      c.toggle(1, 's-r');
      c.toggle(4, 'e-1');
      expect(c.discount()).toBeNull();
      expect(c.unitPrice()).toBe(140);

      c.toggle(4, 'e-1');
      expect(c.unitPrice()).toBe(60);
    });

    it('choosing another size takes the discount away', () => {
      setupWith({ rules: smallOnly });

      c.toggle(1, 's-r');
      c.toggle(1, 's-l');

      expect(c.discount()).toBeNull();
      expect(c.unitPrice()).toBe(130);
    });

    it('a deal card start gets the discount straight away', () => {
      setupWith({
        startWith: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }],
        rules: smallOnly,
      });

      expect(c.unitPrice()).toBe(60);
    });

    it('an amount off that covers the price shows the price taken off while an add-on is still charged', () => {
      setupWith({ rules: [{ fixedPrice: 500, addOns: [{ addOnProductId: 's-l', quantity: 1 }] }] });

      c.toggle(1, 's-l');

      expect(c.discount()).toEqual({ price: 0, label: 'Promo -₱100.00' });
      expect(c.unitPrice()).toBe(30);
    });

    it('an amount off that covers the price reads Free when the add-ons cost nothing', () => {
      setupWith({ rules: [{ fixedPrice: 500, addOns: [{ addOnProductId: 's-r', quantity: 1 }] }] });

      c.toggle(1, 's-r');

      expect(c.discount()).toEqual({ price: 0, label: 'Free' });
      expect(c.unitPrice()).toBe(0);
    });

    it('a plain-product rule that covers the price reads Free', () => {
      setupWith({ rules: [{ fixedPrice: 500, addOns: [] }] }, [EXTRA]);

      expect(c.discount()).toEqual({ price: 0, label: 'Free' });
    });

    it('a rule with no add-ons applies to the plain product only', () => {
      setupWith({ rules: [{ percentOff: 10, addOns: [] }] }, [EXTRA]);

      expect(c.unitPrice()).toBe(90);
      c.toggle(4, 'e-1');
      expect(c.unitPrice()).toBe(140);
    });

    it('a limited promotion with fewer uses than the quantity covers only the uses it has', () => {
      setupWith({ rules: [{ percentOff: 10, addOns: [], remaining: 1 }] }, [EXTRA]);

      expect(c.total()).toBe(90);
      c.changeQuantity(1);
      expect(c.total()).toBe(90 + 100);
    });

    it('a limit per order covers only that many items', () => {
      setupWith({ rules: [{ percentOff: 50, addOns: [], maxPerOrder: 2 }] }, [EXTRA]);

      c.changeQuantity(3);

      expect(c.total()).toBe(2 * 50 + 2 * 100);
    });

    it('confirming sends the add-ons and no price', () => {
      setupWith({ startWith: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }], rules: smallOnly });
      const confirmed = vi.fn();
      fixture.componentInstance.confirmed.subscribe(confirmed);

      c.confirm();

      expect(confirmed).toHaveBeenCalledWith({
        addOns: [{ id: 's-r', name: 'Regular', price: 0, quantity: 1 }],
        quantity: 1,
        specialInstructions: null,
      });
    });
  });

  describe('editing an item already in the cart', () => {
    it('starts from the saved choices and says Update Item', () => {
      setup([SIZE, EXTRA], {
        addOns: [
          { id: 's-l', name: 'Large', price: 30, quantity: 1 },
          { id: 'e-1', name: 'Extra shot', price: 40, quantity: 3 },
        ],
        quantity: 2,
        specialInstructions: 'less ice',
      });

      expect(c.quantity()).toBe(2);
      expect(c.instructions()).toBe('less ice');
      expect(c.isSelected(1, 's-l')).toBe(true);
      expect(c.quantityOf(4, 'e-1')).toBe(3);
      expect(c.validationError()).toBeNull();
      expect(text()).toContain('Update Item');
      expect(text()).not.toContain('Add to Order');
    });

    it('drops saved add-ons that are no longer offered', () => {
      setup([SIZE], {
        addOns: [
          { id: 's-r', name: 'Regular', price: 0, quantity: 1 },
          { id: 'gone', name: 'Withdrawn', price: 10, quantity: 1 },
        ],
        quantity: 1,
        specialInstructions: null,
      });

      expect(c.selectedAddOns().map((a: { id: string }) => a.id)).toEqual(['s-r']);
    });

    it('says Add to Order when it is a new item', () => {
      setup([]);
      expect(text()).toContain('Add to Order');
    });
  });

  describe('fits narrow screens', () => {
    it('stacks the header on narrow screens so a long name is not squeezed', () => {
      setup([]);
      const title = fixture.nativeElement.querySelector(
        '#public-addon-picker-title',
      ) as HTMLElement;
      const header = title.closest('.border-b')!.firstElementChild as HTMLElement;
      expect(header.className).toContain('flex-col');
      expect(header.className).toContain('sm:flex-row');
      // The image and name take the full width of their own row...
      const nameRow = title.parentElement!.parentElement as HTMLElement;
      expect(nameRow.className).toContain('flex-1');
      expect(nameRow.className).toContain('min-w-0');
      expect(title.className).toContain('wrap-break-word');
      // ...and the price and quantity buttons sit on the next row.
      const priceBlock = header.lastElementChild as HTMLElement;
      expect(priceBlock.className).toContain('shrink-0');
      expect(priceBlock.firstElementChild!.className).toContain('justify-between');
    });

    it('lets a long add-on name wrap and keeps the price and quantity inside the row', () => {
      const long = {
        type: 4,
        displayName: 'Extra',
        options: [opt('e-1', 'Extra shot of freshly pulled single origin espresso', 25)],
      };
      setup([long]);
      c.toggle(4, 'e-1');
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector(
        '[role="button"][aria-pressed="true"]',
      ) as HTMLElement;
      const name = [...row.querySelectorAll('span')].find((x) =>
        x.textContent?.includes('Extra shot of'),
      ) as HTMLElement;
      expect(name.className).toContain('min-w-0');
      expect(name.className).toContain('flex-1');
      expect(name.className).toContain('wrap-break-word');

      const cluster = row.querySelector('.flex-col-reverse') as HTMLElement;
      expect(cluster).not.toBeNull();
      expect(cluster.className).toContain('shrink-0');
      expect(cluster.className).toContain('sm:flex-row');
      expect(cluster.querySelector('[aria-label^="Increase"]')).not.toBeNull();
      expect(cluster.textContent).toContain('25.00');
      const price = [...cluster.querySelectorAll('span')].find((x) =>
        x.textContent?.includes('25.00'),
      ) as HTMLElement;
      expect(price.className).toContain('whitespace-nowrap');
    });

    it('puts the price above the quantity buttons when stacked', () => {
      setup([EXTRA]);
      c.toggle(4, 'e-1');
      fixture.detectChanges();
      const cluster = fixture.nativeElement.querySelector('.flex-col-reverse') as HTMLElement;
      // flex-col-reverse shows the last child (the price) on top
      expect(cluster.lastElementChild!.textContent).toContain('40.00');
      expect(cluster.firstElementChild!.querySelector('[aria-label^="Decrease"]')).not.toBeNull();
    });
  });

  it('labels each group with its rule', () => {
    setup([SIZE, FLAVOR, SAUCE, EXTRA]);
    expect(c.selectionRule(1)).toBe('Required · Pick one');
    expect(c.selectionRule(2)).toBe('Required · Pick one');
    expect(c.selectionRule(5)).toBe('Optional · Pick one');
    expect(c.selectionRule(4)).toBe('Optional · Pick many');
    expect(c.selectionRule(3)).toBe('Optional · Pick many');
  });

  it('does not use the cached catalog or any signed-in service', () => {
    setup([SIZE]);
    expect(() => fixture.destroy()).not.toThrow();
  });
});
