import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FulfillmentTypeEnum, PaymentMethodEnum } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internals, Internals } from '../../../testing/management-spec-helpers';
import { PublicCheckoutComponent, PublicCheckoutForm } from './public-checkout';

describe('PublicCheckoutComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let fixture: ComponentFixture<PublicCheckoutComponent>;
  let c: Internals;
  let submitted: ReturnType<typeof vi.fn<(form: PublicCheckoutForm) => void>>;
  let cancelled: ReturnType<typeof vi.fn<() => void>>;

  function setup(
    opts: {
      total?: number;
      address?: string | null;
      contact?: string | null;
      busy?: boolean;
      error?: string | null;
    } = {},
  ) {
    fixture = TestBed.createComponent(PublicCheckoutComponent);
    fixture.componentRef.setInput('total', opts.total ?? 360);
    fixture.componentRef.setInput('defaultAddress', opts.address ?? null);
    fixture.componentRef.setInput('defaultContact', opts.contact ?? null);
    fixture.componentRef.setInput('isBusy', opts.busy ?? false);
    fixture.componentRef.setInput('serverError', opts.error ?? null);
    c = internals(fixture.componentInstance);
    submitted = vi.fn<(form: PublicCheckoutForm) => void>();
    cancelled = vi.fn<() => void>();
    fixture.componentInstance.submitted.subscribe(submitted);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const button = (label: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label)) as
      | HTMLButtonElement
      | undefined;
  const input = (id: string) =>
    el().querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement;

  function type(id: string, value: string) {
    const field = input(id);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fillValid() {
    type('checkout-contact', '0917 123 4567');
    type('checkout-amount', '500');
  }

  const lastForm = () => submitted.mock.calls[0][0] as PublicCheckoutForm;
  const status = () => el().querySelector('[data-cash-status]') as HTMLElement;

  /** Presses Place Order and holds it for as long as it takes. */
  function hold(ms = 1100) {
    const target = button('Place Order') ?? button('Placing order');
    target!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    vi.advanceTimersByTime(ms);
    target!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    fixture.detectChanges();
  }

  describe('layout', () => {
    it('is a centered dialog over a blurred backdrop, like the add-on picker', () => {
      setup();
      const dialog = el().querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.className).toContain('items-center');
      expect(dialog.className).toContain('justify-center');
      expect(dialog.className).toContain('backdrop-blur-md');
      expect(dialog.className).toContain('backdrop-fade');
      expect((el().querySelector('[role="document"]') as HTMLElement).className).toContain(
        'modal-pop',
      );
    });

    it('shows the total and starts on pickup with cash', () => {
      setup({ total: 360 });
      expect(text()).toContain('360.00');
      expect(c.fulfillment()).toBe(FulfillmentTypeEnum.Pickup);
      expect(c.payment()).toBe(PaymentMethodEnum.Cash);
      expect(el().querySelector('#checkout-address')).toBeNull();
      expect(el().querySelector('#checkout-amount')).not.toBeNull();
    });

    it('offers pickup and delivery, and cash and GCash, as radio choices', () => {
      setup();
      const radios = [...el().querySelectorAll('[role="radio"]')] as HTMLElement[];
      expect(radios.map((r) => r.textContent?.trim())).toEqual([
        'Pickup',
        'Delivery',
        'Cash',
        'GCash',
      ]);
      expect(radios[0].getAttribute('aria-checked')).toBe('true');
      expect(radios[1].getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('handover', () => {
    it('shows the address field only for delivery, prefilled with the address on file', () => {
      setup({ address: '12 Main St' });
      button('Delivery')!.click();
      fixture.detectChanges();

      expect(input('checkout-address').value).toBe('12 Main St');
      button('Pickup')!.click();
      fixture.detectChanges();
      expect(el().querySelector('#checkout-address')).toBeNull();
    });

    it('prefills the contact number saved on the customer, which can still be changed', () => {
      setup({ contact: '0917 123 4567' });
      expect(c.contact()).toBe('0917 123 4567');
      c.onContact('0999 000 1111');
      expect(c.contact()).toBe('0999 000 1111');
    });

    it('starts with no contact number when none is saved', () => {
      setup();
      expect(c.contact()).toBe('');
    });

    it('lets the customer change the address and limits it to 300 characters', () => {
      setup({ address: 'old' });
      button('Delivery')!.click();
      fixture.detectChanges();

      type('checkout-address', '  5 Side St  ');
      expect(c.address()).toBe('  5 Side St  ');
      c.onAddress('x'.repeat(500));
      expect(c.address().length).toBe(300);
    });

    it('cuts an over-long address on file to the limit', () => {
      setup({ address: 'a'.repeat(400) });
      expect(c.address().length).toBe(300);
    });

    it('needs an address for delivery', () => {
      setup();
      button('Delivery')!.click();
      type('checkout-contact', '0917 123 4567');
      type('checkout-amount', '500');

      hold();
      fixture.detectChanges();

      expect(submitted).not.toHaveBeenCalled();
      expect(text()).toContain('Please enter your delivery address.');
      expect(input('checkout-address').getAttribute('aria-invalid')).toBe('true');
    });

    it('treats a blank address as missing', () => {
      setup({ address: '   ' });
      button('Delivery')!.click();
      fillValid();
      hold();

      expect(submitted).not.toHaveBeenCalled();
    });
  });

  describe('contact number', () => {
    it('is required', () => {
      setup();
      type('checkout-amount', '500');
      hold();
      fixture.detectChanges();

      expect(submitted).not.toHaveBeenCalled();
      expect(text()).toContain('Please enter a contact number.');
    });

    it.each(['call me', '12345', '0917-ABC-4567', '<script>', '++', '(1) (2)'])(
      'rejects %s',
      (value) => {
        setup();
        type('checkout-contact', value);
        type('checkout-amount', '500');
        hold();
        fixture.detectChanges();

        expect(submitted).not.toHaveBeenCalled();
        expect(text()).toContain('Please enter a valid contact number.');
      },
    );

    it.each(['0917 123 4567', '+63 917 123 4567', '(02) 8123-4567', '09171234567'])(
      'accepts %s',
      (value) => {
        setup();
        type('checkout-contact', value);
        type('checkout-amount', '500');
        hold();

        expect(submitted).toHaveBeenCalledTimes(1);
        expect(lastForm().contactNumber).toBe(value);
      },
    );

    it('is limited to 30 characters', () => {
      setup();
      c.onContact('1'.repeat(60));
      expect(c.contact().length).toBe(30);
      expect(input('checkout-contact').getAttribute('maxlength')).toBe('30');
    });

    it('uses a phone keypad on phones', () => {
      setup();
      expect(input('checkout-contact').getAttribute('type')).toBe('tel');
      expect(input('checkout-contact').getAttribute('inputmode')).toBe('tel');
    });
  });

  describe('keeping a changed number or address', () => {
    const box = () => el().querySelector('[data-save-details]') as HTMLInputElement | null;
    const tick = () => {
      box()!.click();
      fixture.detectChanges();
    };
    const toDelivery = () => {
      button('Delivery')!.click();
      fixture.detectChanges();
    };

    it('does not ask while everything is the same as on file', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();

      expect(box()).toBeNull();
    });

    it('does not ask for a blank or invalid number', () => {
      setup({ contact: '0917 123 4567' });
      type('checkout-contact', '12');

      expect(box()).toBeNull();
    });

    it('asks once the number differs, and says it is the number', () => {
      setup({ contact: '0917 123 4567' });
      type('checkout-contact', '0999 888 7777');

      expect(box()).not.toBeNull();
      expect(text()).toContain('Save my new number for next time');
    });

    it('asks to save a number when none is on file', () => {
      setup();
      type('checkout-contact', '0999 888 7777');

      expect(box()).not.toBeNull();
    });

    it('asks about the address, only for a delivery', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();
      type('checkout-address', '9 New St');

      expect(text()).toContain('Save my new address for next time');
      button('Pickup')!.click();
      fixture.detectChanges();
      expect(box()).toBeNull();
    });

    it('is one box for both when both changed', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();
      type('checkout-address', '9 New St');
      type('checkout-contact', '0999 888 7777');

      expect(el().querySelectorAll('[data-save-details]').length).toBe(1);
      expect(text()).toContain('Save my new number and address for next time');
    });

    it('stops asking when the value is changed back', () => {
      setup({ contact: '0917 123 4567' });
      type('checkout-contact', '0999 888 7777');
      type('checkout-contact', ' 0917 123 4567 ');

      expect(box()).toBeNull();
    });

    it('starts as no', () => {
      setup({ contact: '0917 123 4567' });
      type('checkout-contact', '0999 888 7777');
      type('checkout-amount', '500');
      hold();

      expect(lastForm().saveContactNumber).toBe(false);
      expect(lastForm().saveAddress).toBe(false);
    });

    it('keeps only what changed when ticked', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();
      type('checkout-address', '9 New St');
      type('checkout-amount', '500');
      tick();
      hold();

      expect(lastForm().saveAddress).toBe(true);
      expect(lastForm().saveContactNumber).toBe(false);
    });

    it('keeps both when both changed and it is ticked', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();
      type('checkout-address', '9 New St');
      type('checkout-contact', '0999 888 7777');
      type('checkout-amount', '500');
      tick();
      hold();

      expect(lastForm().saveAddress).toBe(true);
      expect(lastForm().saveContactNumber).toBe(true);
    });

    it('never keeps a value that is back to the one on file', () => {
      setup({ contact: '0917 123 4567' });
      type('checkout-contact', '0999 888 7777');
      tick();
      type('checkout-contact', '0917 123 4567');
      type('checkout-amount', '500');
      hold();

      expect(lastForm().saveContactNumber).toBe(false);
    });

    it('never keeps an address for a pickup', () => {
      setup({ address: '5 Side St', contact: '0917 123 4567' });
      toDelivery();
      type('checkout-address', '9 New St');
      tick();
      button('Pickup')!.click();
      fixture.detectChanges();
      type('checkout-amount', '500');
      hold();

      expect(lastForm().saveAddress).toBe(false);
    });
  });

  describe('payment', () => {
    it('needs a cash amount that covers the total', () => {
      setup({ total: 360 });
      type('checkout-contact', '0917 123 4567');

      hold();
      fixture.detectChanges();
      expect(text()).toContain('Please enter the amount you will pay in cash.');

      type('checkout-amount', '359.99');
      hold();
      fixture.detectChanges();
      expect(text()).toContain('The amount must be at least ₱360.00.');
      expect(submitted).not.toHaveBeenCalled();
    });

    it('rejects a nonsense or absurd cash amount', () => {
      setup({ total: 360 });
      type('checkout-contact', '0917 123 4567');

      c.amount.set('abc');
      expect(c.amountError()).toBe('Please enter a valid amount.');
      c.amount.set('1000001');
      expect(c.amountError()).toBe('That amount is too large.');
      c.amount.set('-5');
      expect(c.amountError()).toContain('at least');
    });

    it('accepts exactly the total and shows no change', () => {
      setup({ total: 360 });
      fillValid();
      type('checkout-amount', '360');
      hold();

      expect(submitted).toHaveBeenCalledTimes(1);
      expect(lastForm().amountReceived).toBe(360);
      expect(c.change()).toBe(0);
    });

    it('shows the change to prepare while typing', () => {
      setup({ total: 360 });
      type('checkout-amount', '500');
      expect(status().textContent).toContain('Change to prepare');
      expect(status().textContent).toContain('₱140.00');

      type('checkout-amount', '300');
      expect(status().textContent).not.toContain('Change to prepare');
      expect(c.change()).toBeNull();
    });

    it('fills in the exact amount with one tap', () => {
      setup({ total: 360.5 });
      button('Exact amount')!.click();
      fixture.detectChanges();

      expect(input('checkout-amount').value).toBe('360.50');
      expect(c.amountError()).toBeNull();
    });

    it('asks for no amount when paying with GCash, and sends none', () => {
      setup();
      button('GCash')!.click();
      fixture.detectChanges();
      expect(el().querySelector('#checkout-amount')).toBeNull();
      expect(text()).toContain('You will pay with GCash.');

      type('checkout-contact', '0917 123 4567');
      hold();

      expect(submitted).toHaveBeenCalledTimes(1);
      expect(lastForm().paymentMethod).toBe(PaymentMethodEnum.GCash);
      expect(lastForm().amountReceived).toBeNull();
    });

    it('does not keep a typed cash amount when switching to GCash', () => {
      setup();
      type('checkout-amount', '999');
      button('GCash')!.click();
      type('checkout-contact', '0917 123 4567');
      hold();

      expect(lastForm().amountReceived).toBeNull();
    });
  });

  describe('hold to place the order', () => {
    it('tells the customer to press and hold', () => {
      setup();
      expect(el().querySelector('[data-hold-help]')!.textContent).toContain('Press and hold');
      expect(el().querySelector('[data-hold-help]')!.textContent).toContain('Place Order');
      expect(el().querySelector('app-hold-button')).not.toBeNull();
    });

    it('does not place the order on a quick tap and reminds how it works', () => {
      setup();
      fillValid();

      const target = button('Place Order')!;
      target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      vi.advanceTimersByTime(200);
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      target.click();
      fixture.detectChanges();

      expect(submitted).not.toHaveBeenCalled();
      expect(el().querySelector('[data-hold-help]')!.textContent).toContain(
        'Keep holding until the button fills',
      );
    });

    it('does not place the order a moment before the hold is long enough', () => {
      setup();
      fillValid();
      hold(900);

      expect(submitted).not.toHaveBeenCalled();
    });

    it('places the order once held for a second', () => {
      setup();
      fillValid();
      hold();

      expect(submitted).toHaveBeenCalledTimes(1);
    });

    it('places the order from the keyboard by holding Enter', () => {
      setup();
      fillValid();

      const target = button('Place Order')!;
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      vi.advanceTimersByTime(1100);

      expect(submitted).toHaveBeenCalledTimes(1);
    });

    it('still checks the form when it is held, and shows what is missing', () => {
      setup();
      hold();
      fixture.detectChanges();

      expect(submitted).not.toHaveBeenCalled();
      expect(text()).toContain('Please enter a contact number.');
    });
  });

  describe('the cash amount box', () => {
    it('shows the peso icon inside the box, above the input and out of the way of taps', () => {
      setup();
      const icon = el().querySelector('[data-peso-icon]') as HTMLElement;

      expect(icon).not.toBeNull();
      expect(icon.querySelector('app-icon')).not.toBeNull();
      expect(icon.className).toContain('z-10');
      expect(icon.className).toContain('absolute');
      expect(icon.className).toContain('pointer-events-none');
      // The input leaves room for it.
      expect(input('checkout-amount').className).toContain('pl-9');
    });

    it('has no cash amount box (and so no icon for it) when paying with GCash', () => {
      setup();
      button('GCash')!.click();
      fixture.detectChanges();

      // Only the tip box is left, and it keeps its icon.
      expect(el().querySelectorAll('[data-peso-icon]').length).toBe(1);
      expect(el().querySelector('#checkout-amount')).toBeNull();
    });
  });

  describe('tip', () => {
    it('is optional and starts empty, with its own peso icon', () => {
      setup();
      const tipBox = input('checkout-tip');

      expect(tipBox).not.toBeNull();
      expect((tipBox as HTMLInputElement).value).toBe('');
      expect(text()).toContain('Tip for the shop (Optional)');
      expect(tipBox.className).toContain('pl-9');
      expect(tipBox.parentElement!.querySelector('[data-peso-icon]')).not.toBeNull();
    });

    it('is offered for GCash too', () => {
      setup();
      button('GCash')!.click();
      fixture.detectChanges();

      expect(el().querySelector('#checkout-tip')).not.toBeNull();
    });

    it('is sent with the order', () => {
      setup({ total: 360 });
      type('checkout-contact', '0917 123 4567');
      type('checkout-tip', '20');
      type('checkout-amount', '400');
      hold();

      expect(lastForm().tips).toBe(20);
      expect(lastForm().amountReceived).toBe(400);
    });

    it('is sent as none when empty, zero or blank', () => {
      for (const value of ['', '0', '   ']) {
        TestBed.resetTestingModule();
        setup({ total: 360 });
        type('checkout-contact', '0917 123 4567');
        type('checkout-tip', value);
        type('checkout-amount', '400');
        hold();

        expect(lastForm().tips).toBeNull();
      }
    });

    it('is added to what the customer has to pay in cash', () => {
      setup({ total: 360 });
      type('checkout-tip', '20');

      expect(c.toPay()).toBe(380);
      expect(text()).toContain('Includes your ₱20.00 tip.');
      type('checkout-amount', '379');
      expect(status().getAttribute('data-status')).toBe('owed');
      type('checkout-amount', '380');
      expect(status().getAttribute('data-status')).toBe('change');
      expect(c.change()).toBe(0);
    });

    it('makes the amount rule count the tip, and says so', () => {
      setup({ total: 360 });
      type('checkout-contact', '0917 123 4567');
      type('checkout-tip', '20');
      type('checkout-amount', '370');
      hold();
      fixture.detectChanges();

      expect(submitted).not.toHaveBeenCalled();
      expect(text()).toContain('The amount must be at least ₱380.00.');
    });

    it('shows the change after the total and the tip', () => {
      setup({ total: 360 });
      type('checkout-tip', '20');
      type('checkout-amount', '500');

      expect(status().textContent).toContain('Change to prepare');
      expect(status().textContent).toContain('₱120.00');
    });

    it('makes the exact amount include the tip', () => {
      setup({ total: 360 });
      type('checkout-tip', '19.5');
      button('Exact amount')!.click();
      fixture.detectChanges();

      expect(input('checkout-amount').value).toBe('379.50');
    });

    it('does not count a tip that is not a usable number', () => {
      setup({ total: 360 });
      c.tip.set('abc');
      expect(c.tipError()).toBe('Please enter a valid tip.');
      expect(c.toPay()).toBe(360);

      c.tip.set('-5');
      expect(c.tipError()).toBe('The tip cannot be negative.');
      expect(c.toPay()).toBe(360);

      c.tip.set('100001');
      expect(c.tipError()).toBe('That tip is too large.');
    });

    it('turns the tip box red and refuses to place the order while the tip is invalid', () => {
      setup({ total: 360 });
      type('checkout-contact', '0917 123 4567');
      type('checkout-tip', '-5');
      type('checkout-amount', '500');

      expect(input('checkout-tip').className).toContain('input-error');
      expect(text()).toContain('The tip cannot be negative.');
      hold();
      expect(submitted).not.toHaveBeenCalled();
    });

    it('rounds a tip to the cent before it counts', () => {
      setup({ total: 360 });
      c.tip.set('12.345');
      expect(c.toPay()).toBe(372.35);
    });
  });

  describe('colors', () => {
    it('is gray while no cash amount has been typed: amount due', () => {
      setup({ total: 360 });

      expect(status().getAttribute('data-status')).toBe('due');
      expect(status().textContent).toContain('Amount due');
      expect(status().textContent).toContain('₱360.00');
      expect(status().className).toContain('bg-gray-50');
      expect(status().className).toContain('border-gray-300');
    });

    it('turns red as soon as the typed amount is too small, with what is still needed', () => {
      setup({ total: 360 });
      type('checkout-amount', '300');

      expect(status().getAttribute('data-status')).toBe('owed');
      expect(status().textContent).toContain('Still needed');
      expect(status().textContent).toContain('₱60.00');
      expect(status().className).toContain('bg-red-50');
      expect(status().className).toContain('text-red-700');
      expect(input('checkout-amount').className).toContain('input-error');
      expect(input('checkout-amount').getAttribute('aria-invalid')).toBe('true');
    });

    it('turns green when the amount covers it, with the change', () => {
      setup({ total: 360 });
      type('checkout-amount', '500');

      expect(status().getAttribute('data-status')).toBe('change');
      expect(status().className).toContain('border-brand');
      expect(status().className).toContain('text-brand-ink-hover');
      expect(input('checkout-amount').className).not.toContain('input-error');
      expect(input('checkout-amount').getAttribute('aria-invalid')).toBeNull();
    });

    it('is green with no change for the exact amount', () => {
      setup({ total: 360 });
      type('checkout-amount', '360');

      expect(status().getAttribute('data-status')).toBe('change');
      expect(status().textContent).toContain('₱0.00');
    });

    it('does not shout red at an empty amount box before the first attempt, but does after', () => {
      setup({ total: 360 });
      expect(input('checkout-amount').className).not.toContain('input-error');

      hold();
      fixture.detectChanges();
      expect(input('checkout-amount').className).toContain('input-error');
      expect(status().getAttribute('data-status')).toBe('due');
    });

    it('goes back to gray when the amount is cleared', () => {
      setup({ total: 360 });
      type('checkout-amount', '100');
      type('checkout-amount', '');

      expect(status().getAttribute('data-status')).toBe('due');
      expect(input('checkout-amount').className).not.toContain('input-error');
    });

    it('marks a wrong contact number or an empty address red after the first attempt', () => {
      setup();
      button('Delivery')!.click();
      fixture.detectChanges();
      type('checkout-address', '');
      type('checkout-contact', 'abc');
      expect(input('checkout-contact').className).not.toContain('input-error');

      hold();
      fixture.detectChanges();

      expect(input('checkout-contact').className).toContain('input-error');
      expect(input('checkout-address').className).toContain('textarea-error');
    });
  });

  describe('the Exact amount button', () => {
    it('is the same height as the amount box (a comfortable tap size)', () => {
      setup();
      const exact = button('Exact amount')!;

      expect(exact.className).toContain('app-btn-md');
      expect(exact.className).not.toContain('app-btn-sm');
      expect(exact.className).toContain('shrink-0');
    });
  });

  describe('the hold help line', () => {
    const help = () => el().querySelector('[data-hold-help]') as HTMLElement;

    it('is one line that explains the hold, and turns into the reminder when the button is let go early', () => {
      setup();
      fillValid();
      expect(help().textContent).toContain('Press and hold');
      expect(help().getAttribute('data-reminding')).toBe('false');

      const target = button('Place Order')!;
      target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      vi.advanceTimersByTime(300);
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      fixture.detectChanges();

      expect(help().textContent).toContain(
        'Keep holding until the button fills to place your order.',
      );
      expect(help().textContent).not.toContain('Press and hold');
      expect(help().getAttribute('data-reminding')).toBe('true');
      expect(help().className).toContain('text-amber-600');
    });

    it('never shows a second message that could overlap it', () => {
      setup();
      fillValid();
      const target = button('Place Order')!;
      target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      vi.advanceTimersByTime(300);
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      fixture.detectChanges();

      // Only the help line speaks: the button's own floating reminder is switched off.
      expect(el().querySelectorAll('[role="status"]').length).toBe(1);
      expect(el().querySelector('app-hold-button [role="status"]')).toBeNull();
    });

    it('goes back to the normal text after a couple of seconds', () => {
      setup();
      fillValid();
      const target = button('Place Order')!;
      target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      vi.advanceTimersByTime(300);
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      fixture.detectChanges();

      vi.advanceTimersByTime(2100);
      fixture.detectChanges();

      expect(help().textContent).toContain('Press and hold');
      expect(help().getAttribute('data-reminding')).toBe('false');
    });

    it('does not remind after the order was placed with a full hold', () => {
      setup();
      fillValid();
      hold();
      fixture.detectChanges();

      expect(help().getAttribute('data-reminding')).toBe('false');
    });

    it('starts the reminder time over when the button is let go early again', () => {
      setup();
      fillValid();
      const target = button('Place Order')!;
      const quickTap = () => {
        target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
        vi.advanceTimersByTime(200);
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      };

      quickTap();
      vi.advanceTimersByTime(1500);
      quickTap();
      vi.advanceTimersByTime(1500);
      fixture.detectChanges();

      expect(help().getAttribute('data-reminding')).toBe('true');
    });
  });

  describe('placing the order', () => {
    it('sends the trimmed pickup details', () => {
      setup({ total: 360 });
      type('checkout-contact', '  0917 123 4567  ');
      type('checkout-amount', '500');
      type('checkout-instructions', '  Call me  ');
      hold();

      expect(lastForm()).toEqual({
        fulfillment: FulfillmentTypeEnum.Pickup,
        deliveryAddress: null,
        contactNumber: '0917 123 4567',
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 500,
        tips: null,
        specialInstructions: 'Call me',
        saveContactNumber: false,
        saveAddress: false,
      });
    });

    it('sends the trimmed address for a delivery', () => {
      setup({ address: '  5 Side St  ' });
      button('Delivery')!.click();
      fillValid();
      hold();

      expect(lastForm().fulfillment).toBe(FulfillmentTypeEnum.Delivery);
      expect(lastForm().deliveryAddress).toBe('5 Side St');
    });

    it('sends no notes when the field is blank', () => {
      setup();
      fillValid();
      type('checkout-instructions', '   ');
      hold();

      expect(lastForm().specialInstructions).toBeNull();
    });

    it('limits the notes to 100 characters and shows the count', () => {
      setup();
      c.onInstructions('x'.repeat(250));
      fixture.detectChanges();

      expect(c.instructions().length).toBe(100);
      expect(text()).toContain('100/100');
    });

    it('shows no errors before the first attempt', () => {
      setup();
      expect(el().querySelector('[role="alert"]')).toBeNull();
      hold();
      fixture.detectChanges();
      expect(el().querySelector('[role="alert"]')).not.toBeNull();
    });

    it('shows a message from the server', () => {
      setup({
        error: 'Some items are no longer available. Please refresh the menu and try again.',
      });
      expect(text()).toContain('Some items are no longer available');
      expect((el().querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
        'no longer available',
      );
    });
  });

  describe('closing and busy', () => {
    it('goes back from the Back button, the backdrop and Escape', () => {
      setup();
      button('Back')!.click();
      (el().querySelector('[role="dialog"]') as HTMLElement).click();
      (el().querySelector('[role="dialog"]') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' }),
      );

      expect(cancelled).toHaveBeenCalledTimes(3);
    });

    it('does not close when the card itself is clicked', () => {
      setup();
      (el().querySelector('[role="document"]') as HTMLElement).click();
      expect(cancelled).not.toHaveBeenCalled();
    });

    it('locks everything while the order is being sent', () => {
      setup({ busy: true });

      expect(text()).toContain('Placing order...');
      expect(button('Placing order')!.disabled).toBe(true);
      expect(button('Back')!.disabled).toBe(true);
      expect(input('checkout-contact').disabled).toBe(true);

      (el().querySelector('[role="dialog"]') as HTMLElement).click();
      (el().querySelector('[role="dialog"]') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' }),
      );
      expect(cancelled).not.toHaveBeenCalled();

      fillValid();
      c.submit();
      expect(submitted).not.toHaveBeenCalled();
    });
  });
});
