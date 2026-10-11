import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalStackService } from '@core/services';
import {
  AddOnTypeEnum,
  CartBundleItemDto,
  CartItemDto,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutModal } from './checkout-modal';

interface Internals {
  change: () => number;
  showSummary: () => boolean;
  hasInsufficientCash: () => boolean;
  hasAmountReceivedInput: () => boolean;
  paymentStatusLabel: () => string;
  paymentStatusAmount: () => number;
  isConfirmDisabled: () => boolean;
  paymentForm: {
    get: (n: string) => { setValue: (v: unknown) => void };
  };
  toggleSummary: () => void;
  confirmOrder: () => void;
  cancelCheckout: () => void;
  onDialogClosed: () => void;
  onDialogCancel: (e: Event) => void;
  isBundleLine: (i: CartItemDto) => boolean;
  getBundleChildTotalQuantity: (l: CartItemDto, c: CartBundleItemDto) => number;
  getBundleChildDisplayRows: (l: CartItemDto, c: CartBundleItemDto) => number[];
  getSortedBundleItems: (i: CartItemDto) => CartBundleItemDto[];
  getGroupedAddOns: (i: CartItemDto) => {
    addOnId: string;
    name: string;
    price: number;
    quantityPerUnit: number;
    lineTotal: number;
  }[];
  getGroupedBundleItemAddOns: (b: CartBundleItemDto) => {
    addOnId: string;
    name: string;
    quantityPerUnit: number;
  }[];
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

  it('toggles summary and renders the order summary', () => {
    setInput('cartItems', [
      { productId: 'p', name: 'Burger', price: 50, qty: 2, specialInstructions: 'no onion' },
    ]);
    setInput('selectedCustomerName', 'Jane');
    setInput('orderSpecialInstructions', 'rush');
    t.toggleSummary();
    fixture.detectChanges();
    expect(t.showSummary()).toBe(true);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Burger');
    expect(text).toContain('Jane');
    expect(text).toContain('no onion');
    expect(text).toContain('rush');
    expect(text).toContain('100.00');
    t.toggleSummary();
    expect(t.showSummary()).toBe(false);
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

  describe('helpers', () => {
    const line = (o: Partial<CartItemDto> = {}): CartItemDto => ({
      productId: 'p',
      name: 'x',
      price: 10,
      qty: 3,
      ...o,
    });
    const child = (o: Partial<CartBundleItemDto> = {}): CartBundleItemDto => ({
      productId: 'c',
      name: 'c',
      price: 0,
      qty: 2,
      ...o,
    });

    it('isBundleLine', () => {
      expect(t.isBundleLine(line())).toBe(false);
      expect(t.isBundleLine(line({ bundleItems: [child()] }))).toBe(true);
    });

    it('bundle child quantity: mix&match uses child qty, fixed multiplies by line qty', () => {
      expect(
        t.getBundleChildTotalQuantity(
          line({ bundlePromotionTypeId: PromotionTypeEnum.MixMatch }),
          child(),
        ),
      ).toBe(2);
      expect(
        t.getBundleChildTotalQuantity(
          line({ bundlePromotionTypeId: PromotionTypeEnum.FixedBundle }),
          child(),
        ),
      ).toBe(6);
      expect(t.getBundleChildTotalQuantity(line({ qty: 0 }), child({ qty: 0 }))).toBe(1);
    });

    it('display rows follow child qty', () => {
      expect(t.getBundleChildDisplayRows(line(), child({ qty: 3 }))).toEqual([0, 1, 2]);
      expect(t.getBundleChildDisplayRows(line(), child({ qty: 0 }))).toEqual([0]);
    });

    it('sorts bundle items ignoring "Nx " prefix and case', () => {
      const items = [
        child({ name: '2x Zebra' }),
        child({ name: 'apple' }),
        child({ name: '3 x Mango' }),
      ];
      expect(t.getSortedBundleItems(line({ bundleItems: items })).map((i) => i.name)).toEqual([
        'apple',
        '3 x Mango',
        '2x Zebra',
      ]);
      expect(t.getSortedBundleItems(line())).toEqual([]);
    });

    it('groups add-ons by id+price, orders by type then name, multiplies by line qty', () => {
      const res = t.getGroupedAddOns(
        line({
          qty: 2,
          addOns: [
            { addOnId: 'a', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
            { addOnId: 'a', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
            { addOnId: 's', name: 'Large', price: 10, addOnType: AddOnTypeEnum.Size },
            { addOnId: 'n', name: 'Misc', price: -2 },
          ],
        }),
      );
      expect(res.map((r) => r.addOnId)).toEqual(['s', 'a', 'n']);
      expect(res[1]).toMatchObject({ quantityPerUnit: 2, lineTotal: 20 });
      expect(res[2].lineTotal).toBe(-4);
    });

    it('groups bundle item add-ons', () => {
      const res = t.getGroupedBundleItemAddOns(
        child({
          addOns: [
            { addOnId: 'a', name: 'B', price: 0, addOnType: AddOnTypeEnum.Extra },
            { addOnId: 'a', name: 'B', price: 0, addOnType: AddOnTypeEnum.Extra },
            { addOnId: 'z', name: 'A', price: 0, addOnType: AddOnTypeEnum.Size },
          ],
        }),
      );
      expect(res).toEqual([
        { addOnId: 'z', name: 'A', quantityPerUnit: 1 },
        { addOnId: 'a', name: 'B', quantityPerUnit: 2 },
      ]);
      expect(t.getGroupedBundleItemAddOns(child())).toEqual([]);
    });
  });
});
