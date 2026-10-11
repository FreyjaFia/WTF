import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { ServiceErrorMessages, SuccessMessages } from '@core/messages';
import { AlertService, ImageDownloadService } from '@core/services';
import {
  AddOnTypeEnum,
  CartAddOnDto,
  CartBundleItemDto,
  CartItemDto,
  OrderStatusEnum,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderReceiptComponent, ReceiptData } from './order-receipt';

interface Internals {
  hasPaymentInfo(): boolean;
  paymentMethodLabel(): string;
  isGenerating(): boolean;
  logoDataUri: { (): string; set(v: string): void };
  getItemTotal(i: CartItemDto): number;
  getUnitSubtotal(i: CartItemDto): number;
  isBundleLine(i: CartItemDto): boolean;
  getBundleChildTotalQuantity(l: CartItemDto, c: CartBundleItemDto): number;
  getBundleChildDisplayRows(l: CartItemDto, c: CartBundleItemDto): number[];
  getSortedBundleItems(i: CartItemDto): CartBundleItemDto[];
  getGroupedAddOns(i: CartItemDto): {
    addOnId: string;
    name: string;
    price: number;
    quantityPerUnit: number;
    lineTotal: number;
  }[];
  getGroupedBundleItemAddOns(
    b: CartBundleItemDto,
  ): { addOnId: string; name: string; quantityPerUnit: number }[];
  waitForLogoRender(): Promise<void>;
}

const ao = (id: string, name: string, price: number, type?: AddOnTypeEnum): CartAddOnDto => ({
  addOnId: id,
  name,
  price,
  addOnType: type,
});

const item = (over: Partial<CartItemDto> = {}): CartItemDto => ({
  productId: 'p1',
  name: 'Latte',
  price: 100,
  qty: 1,
  ...over,
});

function receipt(over: Partial<ReceiptData> = {}): ReceiptData {
  return {
    customerName: 'Walk-in',
    date: '2026-01-01',
    status: OrderStatusEnum.Pending,
    items: [item()],
    totalAmount: 100,
    ...over,
  };
}

describe('OrderReceiptComponent', () => {
  let download: { downloadElementAsImage: ReturnType<typeof vi.fn> };
  let alerts: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    download = { downloadElementAsImage: vi.fn().mockResolvedValue(undefined) };
    alerts = { success: vi.fn(), error: vi.fn() };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageDownloadService, useValue: download },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(data: ReceiptData | null = receipt()) {
    const fixture = TestBed.createComponent(OrderReceiptComponent);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    const i = fixture.componentInstance as unknown as Internals;
    return { fixture, cmp: fixture.componentInstance, i, el: fixture.nativeElement as HTMLElement };
  }

  describe('rendering', () => {
    it('renders header, item and total (smoke)', () => {
      const { el } = setup(receipt({ orderNumber: 12, totalAmount: 1234.5 }));
      const text = el.textContent ?? '';
      expect(text).toContain('Order #12');
      expect(text).toContain('Walk-in');
      expect(text).toContain('Latte');
      expect(text).toContain('1,234.50');
      expect(text).toContain('Thank you for your order!');
    });

    it('prefers the order label over the number, and falls back to New Order', () => {
      expect(setup(receipt({ orderLabel: 'A-5', orderNumber: 3 })).el.textContent).toContain(
        'Order A-5',
      );
      expect(setup(receipt()).el.textContent).toContain('New Order');
    });

    it('renders with null data', () => {
      const { el } = setup(null);
      expect(el.textContent).toContain('New Order');
      expect(el.textContent).toContain('0.00');
    });

    it('shows the order note only when non-blank', () => {
      expect(setup(receipt({ specialInstructions: 'No straw' })).el.textContent).toContain(
        'No straw',
      );
      expect(setup(receipt({ specialInstructions: '   ' })).el.textContent).not.toContain('Note');
    });

    it('shows payment details only for settled orders', () => {
      const none = setup(receipt()).el.textContent;
      expect(none).not.toContain('Payment');
      const paid = setup(
        receipt({
          paymentMethod: PaymentMethodEnum.GCash,
          amountReceived: 200,
          tips: 10,
          changeAmount: 90,
        }),
      ).el.textContent as string;
      expect(paid).toContain('GCash');
      expect(paid).toContain('Amount Received');
      expect(paid).toContain('Tips');
      expect(paid).toContain('Change');
    });

    it('hides zero tips and zero change', () => {
      const text = setup(
        receipt({ paymentMethod: PaymentMethodEnum.Cash, tips: 0, changeAmount: 0, amountReceived: 0 }),
      ).el.textContent as string;
      expect(text).toContain('Amount Received');
      expect(text).not.toContain('Tips');
      expect(text).not.toContain('Change');
    });

    it('renders grouped add-ons for a plain line', () => {
      const { el } = setup(
        receipt({
          items: [item({ qty: 2, addOns: [ao('x', 'Extra Shot', 20), ao('x', 'Extra Shot', 20)] })],
        }),
      );
      expect(el.textContent).toContain('Extra Shot');
    });

    it('renders bundle child items', () => {
      const { el } = setup(
        receipt({
          items: [
            item({
              bundlePromotionId: 'b1',
              bundleItems: [{ productId: 'c1', name: 'Fries', price: 0, qty: 1 }],
            }),
          ],
        }),
      );
      expect(el.textContent).toContain('Fries');
    });
  });

  describe('computed helpers', () => {
    it('payment method label', () => {
      const labelFor = (m: PaymentMethodEnum | null | undefined) =>
        setup(receipt({ paymentMethod: m })).i.paymentMethodLabel();
      expect(labelFor(PaymentMethodEnum.Cash)).toBe('Cash');
      expect(labelFor(PaymentMethodEnum.GCash)).toBe('GCash');
      expect(labelFor(null)).toBe('N/A');
    });

    it('hasPaymentInfo is based on paymentMethod', () => {
      expect(setup(receipt({ paymentMethod: PaymentMethodEnum.Cash })).i.hasPaymentInfo()).toBe(true);
      expect(setup(receipt({ paymentMethod: null })).i.hasPaymentInfo()).toBe(false);
      expect(setup(null).i.hasPaymentInfo()).toBe(false);
    });

    it('computes unit subtotal and line total including add-ons', () => {
      const { i } = setup();
      const line = item({ qty: 3, price: 100, addOns: [ao('a', 'A', 10), ao('b', 'B', -5)] });
      expect(i.getUnitSubtotal(line)).toBe(105);
      expect(i.getItemTotal(line)).toBe(315);
      expect(i.getItemTotal(item({ qty: 2 }))).toBe(200);
    });

    it('detects bundle lines', () => {
      const { i } = setup();
      expect(i.isBundleLine(item())).toBe(false);
      expect(i.isBundleLine(item({ bundleItems: [] }))).toBe(false);
      expect(
        i.isBundleLine(item({ bundleItems: [{ productId: 'c', name: 'C', price: 0, qty: 1 }] })),
      ).toBe(true);
    });

    it('child total quantity: mix-match ignores line qty, others multiply', () => {
      const { i } = setup();
      const child: CartBundleItemDto = { productId: 'c', name: 'C', price: 0, qty: 2 };
      expect(
        i.getBundleChildTotalQuantity(
          item({ qty: 3, bundlePromotionTypeId: PromotionTypeEnum.MixMatch }),
          child,
        ),
      ).toBe(2);
      expect(
        i.getBundleChildTotalQuantity(
          item({ qty: 3, bundlePromotionTypeId: PromotionTypeEnum.FixedBundle }),
          child,
        ),
      ).toBe(6);
      expect(
        i.getBundleChildTotalQuantity(item({ qty: 0 }), { ...child, qty: 0 }),
      ).toBe(1);
    });

    it('display rows count is max(1, child qty)', () => {
      const { i } = setup();
      const mk = (qty: number): CartBundleItemDto => ({ productId: 'c', name: 'C', price: 0, qty });
      expect(i.getBundleChildDisplayRows(item(), mk(3))).toEqual([0, 1, 2]);
      expect(i.getBundleChildDisplayRows(item(), mk(0))).toEqual([0]);
    });

    it('sorts bundle items by name ignoring "N x" prefixes and case', () => {
      const { i } = setup();
      const line = item({
        bundleItems: [
          { productId: '1', name: '2x Zebra', price: 0, qty: 1 },
          { productId: '2', name: 'apple', price: 0, qty: 1 },
          { productId: '3', name: ' 1 x Mango', price: 0, qty: 1 },
        ],
      });
      expect(i.getSortedBundleItems(line).map((b) => b.productId)).toEqual(['2', '3', '1']);
      expect(i.getSortedBundleItems(item())).toEqual([]);
    });

    it('groups add-ons by id+price, counts per unit, and multiplies by line qty', () => {
      const { i } = setup();
      const line = item({
        qty: 2,
        addOns: [
          ao('s', 'Sugar', 5, AddOnTypeEnum.Extra),
          ao('l', 'Large', 20, AddOnTypeEnum.Size),
          ao('s', 'Sugar', 5, AddOnTypeEnum.Extra),
          ao('s', 'Sugar', 8, AddOnTypeEnum.Extra),
          ao('n', 'Alpha', 1),
        ],
      });
      expect(i.getGroupedAddOns(line)).toEqual([
        { addOnId: 'l', name: 'Large', price: 20, quantityPerUnit: 1, lineTotal: 40 },
        { addOnId: 's', name: 'Sugar', price: 5, quantityPerUnit: 2, lineTotal: 20 },
        { addOnId: 's', name: 'Sugar', price: 8, quantityPerUnit: 1, lineTotal: 16 },
        { addOnId: 'n', name: 'Alpha', price: 1, quantityPerUnit: 1, lineTotal: 2 },
      ]);
      expect(i.getGroupedAddOns(item())).toEqual([]);
    });

    it('uses a minimum line qty of 1 for grouped add-on totals', () => {
      const { i } = setup();
      const [g] = i.getGroupedAddOns(item({ qty: 0, addOns: [ao('a', 'A', 5)] }));
      expect(g.lineTotal).toBe(5);
    });

    it('groups bundle child add-ons by id and sorts by type then name', () => {
      const { i } = setup();
      const child: CartBundleItemDto = {
        productId: 'c',
        name: 'C',
        price: 0,
        qty: 1,
        addOns: [
          ao('t', 'Boba', 0, AddOnTypeEnum.Topping),
          ao('z', 'Small', 0, AddOnTypeEnum.Size),
          ao('t', 'Boba', 0, AddOnTypeEnum.Topping),
        ],
      };
      expect(i.getGroupedBundleItemAddOns(child)).toEqual([
        { addOnId: 'z', name: 'Small', quantityPerUnit: 1 },
        { addOnId: 't', name: 'Boba', quantityPerUnit: 2 },
      ]);
      expect(i.getGroupedBundleItemAddOns({ ...child, addOns: undefined })).toEqual([]);
    });
  });

  describe('generate', () => {
    function prepare(data: ReceiptData | null) {
      const ctx = setup(data);
      vi.spyOn(ctx.i, 'waitForLogoRender').mockResolvedValue(undefined);
      return ctx;
    }

    it('downloads the receipt image named after the order label, then alerts on web', async () => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
      const { cmp, i, el } = prepare(receipt({ orderLabel: 'A-5', orderNumber: 3 }));
      const promise = cmp.generate();
      expect(i.isGenerating()).toBe(true);
      expect(cmp.getIsGenerating()).toBe(true);
      await promise;
      expect(download.downloadElementAsImage).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'WTF-Order-A-5.png',
      );
      expect(el.contains(download.downloadElementAsImage.mock.calls[0][0])).toBe(true);
      expect(alerts.success).toHaveBeenCalledWith(SuccessMessages.OrderReceipt.ImageDownloaded);
      expect(i.isGenerating()).toBe(false);
    });

    it('falls back to the order number, then "new"', async () => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
      await prepare(receipt({ orderNumber: 7 })).cmp.generate();
      expect(download.downloadElementAsImage.mock.calls[0][1]).toBe('WTF-Order-7.png');
      await prepare(null).cmp.generate();
      expect(download.downloadElementAsImage.mock.calls[1][1]).toBe('WTF-Order-new.png');
    });

    it('does not show a success alert on android', async () => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
      await prepare(receipt()).cmp.generate();
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('shows an error and resets the flag when downloading fails', async () => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
      download.downloadElementAsImage.mockRejectedValue(new Error('x'));
      const { cmp, i } = prepare(receipt());
      await cmp.generate();
      expect(alerts.error).toHaveBeenCalledWith(ServiceErrorMessages.Common.GenerateOrderImageFailed);
      expect(alerts.success).not.toHaveBeenCalled();
      expect(i.isGenerating()).toBe(false);
    });
  });

  describe('logo loading', () => {
    it('uses the static asset path until a data URI is available', () => {
      const { i } = setup();
      expect(i.logoDataUri()).toBe('/assets/images/logo_new.png');
    });

    it('replaces the logo with a data URI from fetch when the response is an image', async () => {
      const blob = new Blob(['x'], { type: 'image/png' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }),
      );
      const { i } = setup();
      await vi.waitFor(() => expect(i.logoDataUri().startsWith('data:image/png')).toBe(true));
    });
  });
});
