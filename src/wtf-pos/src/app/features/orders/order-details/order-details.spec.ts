import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  CatalogCacheService,
  OrderService,
  PromotionService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnTypeEnum,
  CartBundleItemDto,
  CartItemDto,
  DiscountedProductPromotionDto,
  OrderDto,
  OrderItemDto,
  OrderStatusEnum,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderDetails } from './order-details';

interface Internals {
  order: { (): OrderDto | null; set: (o: OrderDto | null) => void };
  isLoading: () => boolean;
  isRefreshing: () => boolean;
  isDownloadingReceipt: () => boolean;
  isRefunding: () => boolean;
  showRefundModal: () => boolean;
  refundNote: () => string;
  showRefundNoteError: () => boolean;
  itemCount: () => number;
  canRefund: () => boolean;
  canOverride: () => boolean;
  isCompleted: () => boolean;
  isRefunded: () => boolean;
  isCancelled: () => boolean;
  paymentTipsAmount: () => number;
  paymentChangeAmount: () => number;
  paymentOrderTotal: () => number;
  paymentAmountPaid: () => number;
  paymentTotalPaid: () => number;
  paymentTotalDiscount: () => number;
  detailItems: () => CartItemDto[];
  receiptData: () => {
    customerName: string;
    orderNumber: number;
    totalAmount: number;
    paymentMethod: PaymentMethodEnum | null;
  } | null;
  discountedProductPromotions: (v?: DiscountedProductPromotionDto[]) => unknown;
  backToOrders: () => void;
  refresh: () => void;
  downloadOrderImage: (r: { generate: () => Promise<void> }) => Promise<void>;
  openOverrideEditor: () => void;
  openRefundModal: () => void;
  dismissRefundModal: () => void;
  onRefundNoteInput: (e: Event) => void;
  confirmRefund: () => void;
  getStatusVariant: (s?: OrderStatusEnum | null) => string;
  getStatusLabel: (s?: OrderStatusEnum | null) => string;
  getPaymentMethodLabel: (m?: PaymentMethodEnum | null) => string;
  getOrderDate: (o: OrderDto) => string;
  getOrderItemTotal: (i: OrderItemDto) => number;
  getItemTotal: (i: CartItemDto) => number;
  getUnitSubtotal: (i: CartItemDto) => number;
  getBundleChildTotalQuantity: (l: CartItemDto, c: CartBundleItemDto) => number;
  getBundleChildDisplayRows: (l: CartItemDto, c: CartBundleItemDto) => number[];
  getSortedBundleItems: (i: CartItemDto) => CartBundleItemDto[];
  getGroupedAddOns: (i: CartItemDto) => { addOnId: string; quantityPerUnit: number; lineTotal: number }[];
  getGroupedBundleItemAddOns: (b: CartBundleItemDto) => { addOnId: string; quantityPerUnit: number }[];
  getProductImage: (id: string) => string | null;
}

const orderItem = (o: Partial<OrderItemDto> = {}): OrderItemDto => ({
  id: 'i1',
  productId: 'p1',
  productName: 'Burger',
  quantity: 2,
  price: 50,
  addOns: [],
  ...o,
});

const makeOrder = (o: Partial<OrderDto> = {}): OrderDto => ({
  id: 'o1',
  orderNumber: 12,
  createdAt: '2026-01-02T10:00:00Z',
  createdBy: 'u',
  items: [orderItem()],
  status: OrderStatusEnum.Completed,
  totalAmount: 100,
  ...o,
});

describe('OrderDetails', () => {
  let fixture: ComponentFixture<OrderDetails>;
  let t: Internals;
  let router: Router;
  let canOverride: ReturnType<typeof vi.fn>;
  let orderService: { getOrder: ReturnType<typeof vi.fn>; voidOrder: ReturnType<typeof vi.fn> };
  let alert: Record<string, ReturnType<typeof vi.fn>>;
  let catalog: {
    load: ReturnType<typeof vi.fn>;
    products: ReturnType<typeof signal<unknown[]>>;
    bundlePromotions: ReturnType<typeof signal<unknown[]>>;
    getAddOnsForProduct: ReturnType<typeof vi.fn>;
  };
  let promotions: { getActiveDiscountedProductPromotions: ReturnType<typeof vi.fn> };
  let paramId: string | null;

  const flush = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const create = async (order: OrderDto | null = makeOrder()) => {
    if (order) {
      orderService.getOrder.mockReturnValue(of(order));
    }
    fixture = TestBed.createComponent(OrderDetails);
    t = fixture.componentInstance as unknown as Internals;
    fixture.detectChanges();
    await flush();
  };

  beforeEach(() => {
    paramId = 'o1';
    canOverride = vi.fn().mockReturnValue(true);
    orderService = { getOrder: vi.fn(), voidOrder: vi.fn() };
    alert = {
      error: vi.fn(),
      success: vi.fn(),
      getLoadErrorMessage: vi.fn(() => 'load failed'),
      getUpdateErrorMessage: vi.fn(() => 'update failed'),
    };
    catalog = {
      load: vi.fn().mockResolvedValue(undefined),
      products: signal<unknown[]>([{ id: 'p1', imageUrl: 'img.png' }, { id: 'p2' }]),
      bundlePromotions: signal<unknown[]>([]),
      getAddOnsForProduct: vi.fn().mockReturnValue([]),
    };
    promotions = { getActiveDiscountedProductPromotions: vi.fn().mockReturnValue(of([])) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap(paramId ? { id: paramId } : {}) };
            },
          },
        },
        { provide: OrderService, useValue: orderService },
        { provide: AlertService, useValue: alert },
        { provide: AuthService, useValue: { canOverrideOrders: canOverride } },
        { provide: CatalogCacheService, useValue: catalog },
        { provide: PromotionService, useValue: promotions },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading', () => {
    it('loads order, catalog images and promotions', async () => {
      await create();
      expect(orderService.getOrder).toHaveBeenCalledWith('o1');
      expect(t.order()?.id).toBe('o1');
      expect(t.isLoading()).toBe(false);
      expect(t.getProductImage('p1')).toBe('img.png');
      expect(t.getProductImage('p2')).toBeNull();
      expect(t.getProductImage('zzz')).toBeNull();
      expect(promotions.getActiveDiscountedProductPromotions).toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('12');
    });

    it('redirects to list when route has no id', async () => {
      paramId = null;
      const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await create(null);
      expect(alert['error']).toHaveBeenCalledWith('Order not found.');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
      expect(orderService.getOrder).not.toHaveBeenCalled();
    });

    it('alerts on load error (message, then fallback)', async () => {
      orderService.getOrder.mockReturnValue(throwError(() => new Error('nope')));
      await create(null);
      expect(alert['error']).toHaveBeenCalledWith('nope');
      expect(t.isLoading()).toBe(false);

      orderService.getOrder.mockReturnValue(throwError(() => new Error('')));
      t.refresh();
      expect(alert['error']).toHaveBeenLastCalledWith('load failed');
      expect(t.isRefreshing()).toBe(false);
    });

    it('refresh reloads', async () => {
      await create();
      orderService.getOrder.mockClear();
      t.refresh();
      expect(orderService.getOrder).toHaveBeenCalledTimes(1);
      expect(t.isRefreshing()).toBe(false);
    });

    it('promotion load failure yields empty list', async () => {
      promotions.getActiveDiscountedProductPromotions.mockReturnValue(
        throwError(() => new Error('x')),
      );
      await create();
      expect(t.detailItems().length).toBe(1);
    });

    it('navigates back to list', async () => {
      const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await create();
      t.backToOrders();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });
  });

  describe('computed state', () => {
    it('counts items excluding bundle items and including bundle quantity', async () => {
      await create(
        makeOrder({
          items: [
            orderItem({ quantity: 2 }),
            orderItem({ id: 'i2', productId: 'p2', quantity: 4, bundlePromotionId: 'b1' }),
          ],
          bundlePromotions: [{ promotionId: 'b1', promotionName: 'B', quantity: 2, unitPrice: 80 }],
        }),
      );
      expect(t.itemCount()).toBe(4);
    });

    it('itemCount is zero without order', async () => {
      paramId = 'o1';
      orderService.getOrder.mockReturnValue(throwError(() => new Error('e')));
      await create(null);
      expect(t.itemCount()).toBe(0);
      expect(t.detailItems()).toEqual([]);
      expect(t.receiptData()).toBeNull();
      expect(t.paymentAmountPaid()).toBe(0);
    });

    it('status flags', async () => {
      await create(makeOrder({ status: OrderStatusEnum.Refunded }));
      expect(t.isRefunded()).toBe(true);
      expect(t.isCompleted()).toBe(false);
      expect(t.canRefund()).toBe(false);
      expect(t.canOverride()).toBe(false);
      t.order.set(makeOrder({ status: OrderStatusEnum.Cancelled }));
      expect(t.isCancelled()).toBe(true);
      t.order.set(makeOrder({ status: OrderStatusEnum.Completed }));
      expect(t.canRefund()).toBe(true);
      expect(t.canOverride()).toBe(true);
    });

    it('shows an Overridden badge next to the status only when the order was overridden', async () => {
      await create(makeOrder());
      const overriddenBadges = () =>
        (Array.from(fixture.nativeElement.querySelectorAll('app-badge')) as HTMLElement[]).filter(
          (b) => b.textContent?.trim() === 'Overridden',
        );
      expect(overriddenBadges()).toHaveLength(0);

      t.order.set(makeOrder({ overriddenAt: '2026-01-03T09:00:00Z', overrideReason: 'Wrong total' }));
      fixture.detectChanges();

      expect(overriddenBadges()).toHaveLength(1);
      expect(fixture.nativeElement.textContent).toContain('Completed');
    });

    it('override requires permission', async () => {
      canOverride.mockReturnValue(false);
      await create();
      expect(t.canRefund()).toBe(true);
      expect(t.canOverride()).toBe(false);
    });

    it('payment amounts use amount received when present', async () => {
      await create(
        makeOrder({ totalAmount: 100, amountReceived: 200, changeAmount: 90, tips: 10 }),
      );
      expect(t.paymentAmountPaid()).toBe(200);
      expect(t.paymentChangeAmount()).toBe(90);
      expect(t.paymentTipsAmount()).toBe(10);
      expect(t.paymentOrderTotal()).toBe(100);
      expect(t.paymentTotalPaid()).toBe(110);
    });

    it('payment amounts fall back to total + tips', async () => {
      await create(makeOrder({ totalAmount: 100, amountReceived: null, tips: 5 }));
      expect(t.paymentAmountPaid()).toBe(105);
      expect(t.paymentTotalPaid()).toBe(105);
    });

    it('builds receipt data with walk-in default', async () => {
      await create(makeOrder({ customerName: null, paymentMethod: PaymentMethodEnum.GCash }));
      const r = t.receiptData();
      expect(r?.customerName).toBe('Walk-in customer');
      expect(r?.orderNumber).toBe(12);
      expect(r?.paymentMethod).toBe(PaymentMethodEnum.GCash);
      expect(r?.totalAmount).toBe(100);
    });
  });

  describe('item mapping', () => {
    it('maps regular lines with images and add-on types, expanding quantities', async () => {
      catalog.getAddOnsForProduct.mockReturnValue([
        { type: AddOnTypeEnum.Topping, options: [{ id: 'a1' }] },
      ]);
      await create(
        makeOrder({
          items: [
            orderItem({
              specialInstructions: 'no onion',
              addOns: [orderItem({ id: 'x', productId: 'a1', productName: 'Cheese', quantity: 2, price: 5 })],
            }),
          ],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.imageUrl).toBe('img.png');
      expect(line.specialInstructions).toBe('no onion');
      expect(line.addOns).toEqual([
        { addOnId: 'a1', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
        { addOnId: 'a1', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
      ]);
    });

    it('uses captured originalPrice to compute promo discount', async () => {
      await create(
        makeOrder({
          items: [orderItem({ price: 40, originalPrice: 50, quantity: 3, promoLabel: 'Promo -10' })],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.promoDiscount).toBe(30);
      expect(line.promoLabel).toBe('Promo -10');
      expect(t.paymentTotalDiscount()).toBe(30);
    });

    it('no discount when originalPrice equals price', async () => {
      await create(makeOrder({ items: [orderItem({ price: 50, originalPrice: 50 })] }));
      expect(t.detailItems()[0].promoDiscount).toBeNull();
    });

    it('guesses promo from active discounted-product promotions for legacy lines (fixed)', async () => {
      promotions.getActiveDiscountedProductPromotions.mockReturnValue(
        of([
          {
            id: 'pr',
            name: 'P',
            isActive: true,
            startDate: null,
            endDate: null,
            items: [
              { productId: 'p1', fixedPrice: 10, addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
            ],
          },
        ]),
      );
      await create(
        makeOrder({
          items: [
            orderItem({
              addOns: [orderItem({ id: 'x', productId: 'a1', productName: 'Cheese', quantity: 1, price: 0 })],
            }),
          ],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.promoDiscount).toBe(20);
      expect(line.promoLabel).toContain('Promo -');
      expect(line.promoLabel).toContain('10.00');
    });

    it('guesses percent promos and picks best; ignores mismatching add-ons', async () => {
      promotions.getActiveDiscountedProductPromotions.mockReturnValue(
        of([
          {
            id: 'pr',
            name: 'P',
            isActive: true,
            startDate: null,
            endDate: null,
            items: [
              { productId: 'p1', percentOff: 10, addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
              { productId: 'p1', percentOff: 50, addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
              { productId: 'p1', percentOff: 90, addOns: [{ addOnProductId: 'zz', quantity: 1 }] },
              { productId: 'p1', percentOff: 90, addOns: [] },
              { productId: 'p1', addOns: [{ addOnProductId: 'a1', quantity: 1 }] },
            ],
          },
        ]),
      );
      await create(
        makeOrder({
          items: [
            orderItem({
              addOns: [orderItem({ id: 'x', productId: 'a1', productName: 'Cheese', quantity: 1, price: 0 })],
            }),
          ],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.promoLabel).toBe('Promo -50%');
      expect(line.promoDiscount).toBe(50 * 2 * 0.5);
    });

    it('does not guess promo when line has extra add-ons', async () => {
      promotions.getActiveDiscountedProductPromotions.mockReturnValue(
        of([
          {
            id: 'pr',
            name: 'P',
            isActive: true,
            startDate: null,
            endDate: null,
            items: [{ productId: 'p1', percentOff: 50, addOns: [{ addOnProductId: 'a1', quantity: 1 }] }],
          },
        ]),
      );
      await create(
        makeOrder({
          items: [
            orderItem({
              addOns: [
                orderItem({ id: 'x', productId: 'a1', productName: 'C', quantity: 1, price: 0 }),
                orderItem({ id: 'y', productId: 'a2', productName: 'D', quantity: 1, price: 0 }),
              ],
            }),
          ],
        }),
      );
      expect(t.detailItems()[0].promoDiscount).toBeUndefined();
    });

    it('groups bundle items into a bundle line (fixed bundle divides by bundle qty)', async () => {
      catalog.bundlePromotions.set([{ id: 'b1', typeId: PromotionTypeEnum.FixedBundle }]);
      await create(
        makeOrder({
          items: [
            orderItem({ id: 'i1', productId: 'p2', productName: 'Zed', quantity: 4, price: 0, bundlePromotionId: 'b1', specialInstructions: ' ' }),
            orderItem({ id: 'i2', productId: 'p1', productName: 'Alpha', quantity: 2, price: 0, bundlePromotionId: 'b1', specialInstructions: 'extra hot' }),
          ],
          bundlePromotions: [{ promotionId: 'b1', promotionName: 'Combo', quantity: 2, unitPrice: 80 }],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.name).toBe('Combo');
      expect(line.qty).toBe(2);
      expect(line.price).toBe(80);
      expect(line.bundlePromotionTypeId).toBe(PromotionTypeEnum.FixedBundle);
      expect(line.bundleItems?.map((b) => [b.name, b.qty])).toEqual([
        ['Alpha', 1],
        ['Zed', 2],
      ]);
      expect(line.specialInstructions).toBe('extra hot');
    });

    it('mix & match keeps raw child quantity; unknown bundle meta falls back', async () => {
      catalog.bundlePromotions.set([{ id: 'b1', typeId: PromotionTypeEnum.MixMatch }]);
      await create(
        makeOrder({
          items: [orderItem({ productId: 'p2', quantity: 3, price: 0, bundlePromotionId: 'b1' })],
          bundlePromotions: [],
        }),
      );
      const line = t.detailItems()[0];
      expect(line.name).toBe('Bundle');
      expect(line.qty).toBe(1);
      expect(line.bundleItems?.[0].qty).toBe(3);
    });
  });

  describe('totals and helpers', () => {
    beforeEach(async () => create());

    it('getOrderItemTotal includes add-on prices and quantities', () => {
      const item = orderItem({
        price: 10,
        quantity: 2,
        addOns: [orderItem({ price: 3, quantity: 2 }), orderItem({ price: null, quantity: 1 })],
      });
      expect(t.getOrderItemTotal(item)).toBe(32);
      expect(t.getOrderItemTotal(orderItem({ price: null, quantity: 3 }))).toBe(0);
    });

    it('getItemTotal and getUnitSubtotal', () => {
      const item: CartItemDto = {
        productId: 'p',
        name: 'P',
        price: 10,
        qty: 2,
        addOns: [{ addOnId: 'a', name: 'A', price: 2 }],
      };
      expect(t.getItemTotal(item)).toBe(24);
      expect(t.getUnitSubtotal(item)).toBe(12);
      const bundle: CartItemDto = {
        ...item,
        bundleItems: [{ productId: 'c', name: 'c', price: 0, qty: 1 }],
      };
      expect(t.getItemTotal(bundle)).toBe(20);
      expect(t.getUnitSubtotal(bundle)).toBe(10);
    });

    it('bundle child quantities', () => {
      const line: CartItemDto = { productId: 'b', name: 'b', price: 1, qty: 3 };
      const child: CartBundleItemDto = { productId: 'c', name: 'c', price: 0, qty: 2 };
      expect(t.getBundleChildTotalQuantity(line, child)).toBe(6);
      expect(
        t.getBundleChildTotalQuantity(
          { ...line, bundlePromotionTypeId: PromotionTypeEnum.MixMatch },
          child,
        ),
      ).toBe(2);
      expect(t.getBundleChildDisplayRows(line, child)).toEqual([0, 1]);
    });

    it('sorts bundle items and groups add-ons', () => {
      const line: CartItemDto = {
        productId: 'b',
        name: 'b',
        price: 1,
        qty: 2,
        bundleItems: [
          { productId: 'c', name: '2x Zed', price: 0, qty: 1 },
          { productId: 'd', name: 'Alpha', price: 0, qty: 1 },
        ],
        addOns: [
          { addOnId: 'a', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
          { addOnId: 'a', name: 'Cheese', price: 5, addOnType: AddOnTypeEnum.Topping },
          { addOnId: 's', name: 'Large', price: 1, addOnType: AddOnTypeEnum.Size },
        ],
      };
      expect(t.getSortedBundleItems(line).map((b) => b.name)).toEqual(['Alpha', '2x Zed']);
      const grouped = t.getGroupedAddOns(line);
      expect(grouped.map((g) => g.addOnId)).toEqual(['s', 'a']);
      expect(grouped[1]).toMatchObject({ quantityPerUnit: 2, lineTotal: 20 });
      expect(
        t.getGroupedBundleItemAddOns({
          productId: 'c',
          name: 'c',
          price: 0,
          qty: 1,
          addOns: [
            { addOnId: 'a', name: 'A', price: 0 },
            { addOnId: 'a', name: 'A', price: 0 },
          ],
        }),
      ).toEqual([{ addOnId: 'a', name: 'A', quantityPerUnit: 2 }]);
    });

    it('labels and variants', () => {
      expect(t.getStatusVariant(OrderStatusEnum.Pending)).toBe('warning');
      expect(t.getStatusVariant(OrderStatusEnum.Completed)).toBe('success');
      expect(t.getStatusVariant(OrderStatusEnum.Cancelled)).toBe('default');
      expect(t.getStatusVariant(OrderStatusEnum.Refunded)).toBe('error');
      expect(t.getStatusVariant(null)).toBe('info');
      expect(t.getStatusLabel(OrderStatusEnum.Pending)).toBe('Pending');
      expect(t.getStatusLabel(OrderStatusEnum.Completed)).toBe('Completed');
      expect(t.getStatusLabel(OrderStatusEnum.Cancelled)).toBe('Cancelled');
      expect(t.getStatusLabel(OrderStatusEnum.Refunded)).toBe('Refunded');
      expect(t.getStatusLabel(undefined)).toBe('Unknown');
      expect(t.getPaymentMethodLabel(PaymentMethodEnum.Cash)).toBe('Cash');
      expect(t.getPaymentMethodLabel(PaymentMethodEnum.GCash)).toBe('GCash');
      expect(t.getPaymentMethodLabel(null)).toBe('N/A');
      expect(t.getOrderDate(makeOrder({ createdAt: '', updatedAt: 'u' }))).toBe('u');
    });
  });

  describe('actions', () => {
    it('downloads receipt and toggles flag even on failure', async () => {
      await create();
      const ok = vi.fn().mockResolvedValue(undefined);
      await t.downloadOrderImage({ generate: ok });
      expect(ok).toHaveBeenCalled();
      expect(t.isDownloadingReceipt()).toBe(false);

      const bad = vi.fn().mockRejectedValue(new Error('x'));
      await expect(t.downloadOrderImage({ generate: bad })).rejects.toThrow('x');
      expect(t.isDownloadingReceipt()).toBe(false);
    });

    it('opens override editor only with permission', async () => {
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await create();
      t.openOverrideEditor();
      expect(nav).toHaveBeenCalledWith([AppRoutes.OrderEditorById('o1')], {
        queryParams: { override: 1 },
      });

      nav.mockClear();
      canOverride.mockReturnValue(false);
      t.order.set(makeOrder({ status: OrderStatusEnum.Cancelled }));
      t.openOverrideEditor();
      expect(nav).not.toHaveBeenCalled();
    });

    it('opens refund modal prefilled with the order note', async () => {
      await create(makeOrder({ note: 'prev' }));
      t.openRefundModal();
      expect(t.showRefundModal()).toBe(true);
      expect(t.refundNote()).toBe('prev');
      t.dismissRefundModal();
      expect(t.showRefundModal()).toBe(false);
    });

    it('does not open refund modal for non-completed orders', async () => {
      await create(makeOrder({ status: OrderStatusEnum.Refunded }));
      t.openRefundModal();
      expect(t.showRefundModal()).toBe(false);
    });

    it('refund note input updates value and clears error when non-empty', async () => {
      await create();
      t.openRefundModal();
      t.confirmRefund();
      expect(t.showRefundNoteError()).toBe(true);
      const ta = document.createElement('textarea');
      ta.value = '  ';
      t.onRefundNoteInput({ target: ta } as unknown as Event);
      expect(t.showRefundNoteError()).toBe(true);
      ta.value = 'reason';
      const ev = new Event('input');
      Object.defineProperty(ev, 'target', { value: ta });
      t.onRefundNoteInput(ev);
      expect(t.refundNote()).toBe('reason');
      expect(t.showRefundNoteError()).toBe(false);
      t.onRefundNoteInput(new Event('input'));
      expect(t.refundNote()).toBe('');
    });

    it('requires a note to refund', async () => {
      await create(makeOrder({ note: '' }));
      t.openRefundModal();
      t.confirmRefund();
      expect(alert['error']).toHaveBeenCalledWith('Refund note is required.');
      expect(orderService.voidOrder).not.toHaveBeenCalled();
    });

    it('refunds order successfully', async () => {
      await create(makeOrder({ note: ' damaged ' }));
      const updated = makeOrder({ status: OrderStatusEnum.Refunded });
      orderService.voidOrder.mockReturnValue(of(updated));
      t.openRefundModal();
      t.confirmRefund();
      expect(orderService.voidOrder).toHaveBeenCalledWith('o1', 'damaged');
      expect(t.order()).toBe(updated);
      expect(t.showRefundModal()).toBe(false);
      expect(t.isRefunding()).toBe(false);
      expect(alert['success']).toHaveBeenCalledWith('Order has been refunded');
    });

    it('surfaces refund errors and keeps modal open', async () => {
      await create(makeOrder({ note: 'x' }));
      orderService.voidOrder.mockReturnValue(throwError(() => new Error('')));
      t.openRefundModal();
      t.confirmRefund();
      expect(alert['error']).toHaveBeenCalledWith('update failed');
      expect(t.isRefunding()).toBe(false);
      expect(t.showRefundModal()).toBe(true);

      orderService.voidOrder.mockReturnValue(throwError(() => new Error('server')));
      t.confirmRefund();
      expect(alert['error']).toHaveBeenLastCalledWith('server');
    });

    it('confirmRefund ignores non-refundable orders', async () => {
      await create(makeOrder({ status: OrderStatusEnum.Cancelled }));
      t.confirmRefund();
      expect(orderService.voidOrder).not.toHaveBeenCalled();
    });
  });
});
