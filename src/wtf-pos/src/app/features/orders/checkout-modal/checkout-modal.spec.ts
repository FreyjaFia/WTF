import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import { PaymentMethodEnum } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutModal } from './checkout-modal';

interface Internals {
  change: () => number;
  hasInsufficientCash: () => boolean;
  hasAmountReceivedInput: () => boolean;
  paymentStatusLabel: () => string;
  paymentStatusAmount: () => number;
  isConfirmDisabled: () => boolean;
  isCash: () => boolean;
  paymentForm: {
    get: (n: string) => { setValue: (v: unknown) => void; value: unknown };
  };
  confirmOrder: () => void;
  cancelCheckout: () => void;
  onDialogClosed: () => void;
  onDialogCancel: (e: Event) => void;
  choosePayment: (m: PaymentMethodEnum) => void;
  useExactAmount: () => void;
}

describe('CheckoutModal', () => {
  let fixture: ComponentFixture<CheckoutModal>;
  let cmp: CheckoutModal;
  let t: Internals;
  let modalStack: ModalStackService;
  let showModal: ReturnType<typeof vi.fn>;
  let closeDlg: ReturnType<typeof vi.fn>;

  const setInput = (name: string, value: unknown) => {
    fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  };
  const setAmount = (v: number | null) => t.paymentForm.get('amountReceived').setValue(v);

  beforeEach(() => {
    showModal = vi.fn();
    closeDlg = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
    HTMLDialogElement.prototype.close = closeDlg as unknown as () => void;
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(CheckoutModal);
    cmp = fixture.componentInstance;
    t = cmp as unknown as Internals;
    modalStack = TestBed.inject(ModalStackService);
    fixture.componentRef.setInput('totalPrice', 100);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the dialog, resets state and registers on modal stack', () => {
    cmp.triggerOpen();
    expect(showModal).toHaveBeenCalled();
    expect(modalStack.hasOpen()).toBe(true);
    expect(t.change()).toBe(0);
    expect(t.paymentStatusLabel()).toBe('Amount Due:');
    expect(t.paymentStatusAmount()).toBe(100);
    expect(t.isConfirmDisabled()).toBe(true);
  });

  it('shows the payment a customer already chose, ready to confirm', () => {
    cmp.triggerOpen({ paymentMethod: PaymentMethodEnum.Cash, amountReceived: 150, tips: 10 });
    expect(t.paymentForm.get('paymentMethod').value).toBe(PaymentMethodEnum.Cash);
    expect(t.paymentForm.get('amountReceived').value).toBe(150);
    expect(t.paymentForm.get('tips').value).toBe(10);
    expect(t.change()).toBe(50);
    expect(t.isConfirmDisabled()).toBe(false);
  });

  it('shows a cashless payment the customer chose with no amount', () => {
    cmp.triggerOpen({ paymentMethod: PaymentMethodEnum.GCash, amountReceived: 150, tips: null });
    expect(t.paymentForm.get('paymentMethod').value).toBe(PaymentMethodEnum.GCash);
    expect(t.paymentForm.get('amountReceived').value).toBeNull();
  });

  it('starts empty again after a prefilled opening', () => {
    cmp.triggerOpen({ paymentMethod: PaymentMethodEnum.Cash, amountReceived: 150, tips: 10 });
    cmp.triggerOpen();
    expect(t.paymentForm.get('amountReceived').value).toBeNull();
    expect(t.paymentForm.get('tips').value).toBeNull();
  });

  it('computes change for cash and flags insufficient payment', () => {
    cmp.triggerOpen();
    setAmount(60);
    expect(t.change()).toBe(-40);
    expect(t.hasInsufficientCash()).toBe(true);
    expect(t.paymentStatusLabel()).toBe('Amount Owed:');
    expect(t.paymentStatusAmount()).toBe(40);
    expect(t.isConfirmDisabled()).toBe(true);

    setAmount(150);
    expect(t.change()).toBe(50);
    expect(t.hasInsufficientCash()).toBe(false);
    expect(t.paymentStatusLabel()).toBe('Change Due:');
    expect(t.paymentStatusAmount()).toBe(50);
    expect(t.isConfirmDisabled()).toBe(false);
  });

  it('exact payment gives zero change and enables confirm', () => {
    cmp.triggerOpen();
    setAmount(100);
    expect(t.change()).toBe(0);
    expect(t.isConfirmDisabled()).toBe(false);
  });

  it('clearing the amount returns to neutral state', () => {
    cmp.triggerOpen();
    setAmount(150);
    setAmount(null);
    expect(t.hasAmountReceivedInput()).toBe(false);
    expect(t.change()).toBe(0);
  });

  it('GCash needs no amount, zero change', () => {
    cmp.triggerOpen();
    setAmount(150);
    t.paymentForm.get('paymentMethod').setValue(PaymentMethodEnum.GCash);
    expect(t.change()).toBe(0);
    expect(t.isConfirmDisabled()).toBe(false);
  });

  it('is disabled while busy', () => {
    cmp.triggerOpen();
    setAmount(150);
    setInput('isBusy', true);
    expect(t.isConfirmDisabled()).toBe(true);
  });

  it('emits cash payment with amount, change and tips', () => {
    const emitted: unknown[] = [];
    cmp.orderConfirmed.subscribe((e) => emitted.push(e));
    cmp.triggerOpen();
    setAmount(150);
    t.paymentForm.get('tips').setValue(5);
    t.confirmOrder();
    expect(emitted).toEqual([
      { paymentMethod: PaymentMethodEnum.Cash, amountReceived: 150, changeAmount: 50, tips: 5 },
    ]);
  });

  it('emits GCash payment without amount or change', () => {
    const emitted: unknown[] = [];
    cmp.orderConfirmed.subscribe((e) => emitted.push(e));
    cmp.triggerOpen();
    t.paymentForm.get('paymentMethod').setValue(PaymentMethodEnum.GCash);
    t.confirmOrder();
    expect(emitted).toEqual([
      {
        paymentMethod: PaymentMethodEnum.GCash,
        amountReceived: undefined,
        changeAmount: undefined,
        tips: undefined,
      },
    ]);
  });

  it('does not emit while busy', () => {
    const emitted: unknown[] = [];
    cmp.orderConfirmed.subscribe((e) => emitted.push(e));
    setInput('isBusy', true);
    t.confirmOrder();
    expect(emitted).toEqual([]);
  });

  it('cancel closes unless busy; removes from stack', () => {
    cmp.triggerOpen();
    t.cancelCheckout();
    expect(closeDlg).toHaveBeenCalledTimes(1);
    expect(modalStack.hasOpen()).toBe(false);

    closeDlg.mockClear();
    setInput('isBusy', true);
    t.cancelCheckout();
    expect(closeDlg).not.toHaveBeenCalled();
  });

  it('modal stack pop triggers cancel', () => {
    cmp.triggerOpen();
    expect(modalStack.pop()).toBe(true);
    expect(closeDlg).toHaveBeenCalled();
  });

  it('closes automatically when busy settles', () => {
    cmp.triggerOpen();
    setInput('isBusy', true);
    TestBed.tick();
    expect(closeDlg).not.toHaveBeenCalled();
    setInput('isBusy', false);
    TestBed.tick();
    expect(closeDlg).toHaveBeenCalled();
  });

  it('dialog cancel event is prevented only while busy', () => {
    const ev = new Event('cancel', { cancelable: true });
    t.onDialogCancel(ev);
    expect(ev.defaultPrevented).toBe(false);
    setInput('isBusy', true);
    const ev2 = new Event('cancel', { cancelable: true });
    t.onDialogCancel(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('onDialogClosed removes from stack', () => {
    cmp.triggerOpen();
    t.onDialogClosed();
    expect(modalStack.hasOpen()).toBe(false);
  });

  describe('look and feel (same as the public checkout)', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const text = () => el().textContent ?? '';
    const radio = (label: string) =>
      [...el().querySelectorAll('[role="radio"]')].find((r) => r.textContent?.trim() === label) as HTMLButtonElement;

    it('is a rounded card with a header showing the total', () => {
      const box = el().querySelector('.modal-box') as HTMLElement;
      expect(box.className).toContain('rounded-2xl');
      expect(box.className).toContain('max-w-lg');
      expect(box.className).toContain('modal-pop');
      expect(el().querySelector('h3')!.textContent).toContain('Checkout');
      expect((el().querySelector('[data-checkout-total]') as HTMLElement).textContent).toContain('100.00');
    });

    it('shows the total from the input as it changes', () => {
      setInput('totalPrice', 250.5);
      expect((el().querySelector('[data-checkout-total]') as HTMLElement).textContent).toContain('250.50');
    });

    it('no longer has the order summary or a View Order button', () => {
      expect(text()).not.toContain('Order Summary');
      expect(text()).not.toContain('View Order');
      expect(text()).not.toContain('Hide Order');
      expect(el().querySelector('.modal-box')!.className).not.toContain('max-w-5xl');
    });

    it('offers cash and GCash as radio buttons, cash first and chosen', () => {
      const radios = [...el().querySelectorAll('[role="radio"]')] as HTMLElement[];
      expect(radios.map((r) => r.textContent?.trim())).toEqual(['Cash', 'GCash']);
      expect(radio('Cash').getAttribute('aria-checked')).toBe('true');
      expect(radio('GCash').getAttribute('aria-checked')).toBe('false');
    });

    it('switches payment method from the buttons and hides the cash fields for GCash', () => {
      radio('GCash').click();
      fixture.detectChanges();

      expect(t.paymentForm.get('paymentMethod').value).toBe(PaymentMethodEnum.GCash);
      expect(radio('GCash').getAttribute('aria-checked')).toBe('true');
      expect(el().querySelector('#amountReceived')).toBeNull();
      expect(text()).toContain('The customer pays with GCash.');

      radio('Cash').click();
      fixture.detectChanges();
      expect(el().querySelector('#amountReceived')).not.toBeNull();
    });

    it('does not change the payment method while busy', () => {
      setInput('isBusy', true);
      t.choosePayment(PaymentMethodEnum.GCash);
      expect(t.paymentForm.get('paymentMethod').value).toBe(PaymentMethodEnum.Cash);
    });

    it('shows the peso icon inside the amount received and tips boxes, above the input', () => {
      const icons = [...el().querySelectorAll('[data-peso-icon]')] as HTMLElement[];

      expect(icons.length).toBe(2);
      for (const icon of icons) {
        expect(icon.querySelector('app-icon')).not.toBeNull();
        expect(icon.className).toContain('z-10');
        expect(icon.className).toContain('absolute');
        expect(icon.className).toContain('pointer-events-none');
      }
      expect((el().querySelector('#amountReceived') as HTMLElement).className).toContain('pl-9');
      expect((el().querySelector('#tips') as HTMLElement).className).toContain('pl-9');
    });

    it('fills in the exact amount with one tap and enables confirm', () => {
      cmp.triggerOpen();
      (([...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Exact amount')) as HTMLButtonElement).click();
      fixture.detectChanges();

      expect((el().querySelector('#amountReceived') as HTMLInputElement).value).toBe('100');
      expect(t.change()).toBe(0);
      expect(t.isConfirmDisabled()).toBe(false);
    });

    it('has a Exact amount button as tall as the amount box, not a small one', () => {
      const exact = [...el().querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Exact amount',
      ) as HTMLButtonElement;

      expect(exact.className).toContain('app-btn-md');
      expect(exact.className).not.toContain('app-btn-sm');
    });

    it('turns the amount box red while the amount is too small, and clears it when it is enough', () => {
      cmp.triggerOpen();
      const box = () => el().querySelector('#amountReceived') as HTMLInputElement;
      expect(box().className).not.toContain('input-error');

      setAmount(60);
      fixture.detectChanges();
      expect(box().className).toContain('input-error');
      expect(box().getAttribute('aria-invalid')).toBe('true');

      setAmount(150);
      fixture.detectChanges();
      expect(box().className).not.toContain('input-error');
      expect(box().getAttribute('aria-invalid')).toBeNull();
    });

    it('rounds the exact amount to the cent', () => {
      setInput('totalPrice', 100.456);
      t.useExactAmount();
      expect(t.paymentForm.get('amountReceived').value).toBe(100.46);
    });

    it('does not fill the exact amount while busy', () => {
      setInput('isBusy', true);
      t.useExactAmount();
      expect(t.paymentForm.get('amountReceived').value).toBeNull();
    });

    it('shows what is due, then the change, then what is still owed', () => {
      cmp.triggerOpen();
      fixture.detectChanges();
      expect(text()).toContain('Amount Due:');

      setAmount(150);
      fixture.detectChanges();
      expect(text()).toContain('Change Due:');

      setAmount(60);
      fixture.detectChanges();
      expect(text()).toContain('Amount Owed:');
      expect(el().querySelector('[role="alert"]')!.textContent).toContain('Insufficient payment');
    });

    it('has Cancel and Confirm & Pay in the footer', () => {
      const labels = [...el().querySelectorAll('.border-t button')].map((b) => b.textContent?.trim());
      expect(labels).toEqual(['Cancel', 'Confirm & Pay']);
    });

    it('shows the busy label on the confirm button while saving', () => {
      setInput('isBusy', true);
      setInput('busyLabel', 'Saving Order...');
      expect(text()).toContain('Saving Order...');
    });
  });
});
