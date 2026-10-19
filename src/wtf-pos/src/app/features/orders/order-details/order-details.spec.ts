import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  CatalogCacheService,
  ConversationInboxService,
  ConversationService,
  OrderService,
  PromotionService,
  SignalRService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnTypeEnum,
  CartBundleItemDto,
  CartItemDto,
  DiscountedProductPromotionDto,
  OrderDto,
  OrderItemDto,
  FulfillmentTypeEnum,
  OrderSourceEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
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
  getBreakdown: (i: CartItemDto) => { rows: { kind: string; label: string; detail: string | null; amount: number }[]; total: number };
  getBundleChildTotalQuantity: (l: CartItemDto, c: CartBundleItemDto) => number;
  getBundleChildDisplayRows: (l: CartItemDto, c: CartBundleItemDto) => number[];
  getSortedBundleItems: (i: CartItemDto) => CartBundleItemDto[];
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
  let canWrite: boolean;
  let orderService: {
    getOrder: ReturnType<typeof vi.fn>;
    voidOrder: ReturnType<typeof vi.fn>;
    approveOrder: ReturnType<typeof vi.fn>;
    rejectOrder: ReturnType<typeof vi.fn>;
    approveHeldOrder: ReturnType<typeof vi.fn>;
    rejectHeldOrder: ReturnType<typeof vi.fn>;
  };
  let alert: Record<string, ReturnType<typeof vi.fn>>;
  let catalog: {
    load: ReturnType<typeof vi.fn>;
    products: ReturnType<typeof signal<unknown[]>>;
    bundlePromotions: ReturnType<typeof signal<unknown[]>>;
    getAddOnsForProduct: ReturnType<typeof vi.fn>;
  };
  let promotions: { getActiveDiscountedProductPromotions: ReturnType<typeof vi.fn> };
  let paramId: string | null;
  let queryParams$: BehaviorSubject<ParamMap>;
  let unreadByOrder: Record<string, number>;
  let inbox: { unreadFor: ReturnType<typeof vi.fn> };
  let chatApi: { getOrderConversation: ReturnType<typeof vi.fn> };
  let orderChanged$: Subject<string>;
  let chatHub: {
    orderMessage: Observable<unknown>;
    orderChanged: Observable<string>;
    startStaffOrdersHub: ReturnType<typeof vi.fn>;
    stopStaffOrdersHub: ReturnType<typeof vi.fn>;
  };

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
    canWrite = true;
    orderService = {
      getOrder: vi.fn(),
      voidOrder: vi.fn(),
      approveOrder: vi.fn(),
      rejectOrder: vi.fn(),
      approveHeldOrder: vi.fn(),
      rejectHeldOrder: vi.fn(),
    };
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
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    unreadByOrder = {};
    inbox = { unreadFor: vi.fn((orderId: string) => unreadByOrder[orderId] ?? 0) };
    chatApi = {
      getOrderConversation: vi.fn(() =>
        of({
          conversationId: null,
          orderId: 'o1',
          orderNumber: 5,
          title: 'Order #5',
          canSend: true,
          unreadCount: 0,
          messages: [],
        }),
      ),
    };
    orderChanged$ = new Subject<string>();
    chatHub = {
      orderMessage: new Subject<unknown>().asObservable(),
      orderChanged: orderChanged$.asObservable(),
      startStaffOrdersHub: vi.fn(),
      stopStaffOrdersHub: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap(paramId ? { id: paramId } : {}) };
            },
            queryParamMap: queryParams$.asObservable(),
          },
        },
        { provide: ConversationInboxService, useValue: inbox },
        { provide: ConversationService, useValue: chatApi },
        { provide: SignalRService, useValue: chatHub },
        { provide: OrderService, useValue: orderService },
        { provide: AlertService, useValue: alert },
        {
          provide: AuthService,
          useValue: { canOverrideOrders: canOverride, canWriteOrders: () => canWrite },
        },
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

    it('reloads quietly when this order changes elsewhere, and ignores other orders', async () => {
      await create();
      orderService.getOrder.mockClear();

      orderChanged$.next('some-other-order');
      expect(orderService.getOrder).not.toHaveBeenCalled();

      orderChanged$.next(t.order()!.id);
      expect(orderService.getOrder).toHaveBeenCalledTimes(1);
      expect(t.isLoading()).toBe(false);
    });

    it('listens to the staff hub while open and lets go of it after', async () => {
      await create();
      expect(chatHub.startStaffOrdersHub).toHaveBeenCalled();

      fixture.destroy();

      expect(chatHub.stopStaffOrdersHub).toHaveBeenCalled();
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
          status: OrderStatusEnum.Pending,
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

    it('does not guess a promo for a waiting line the limited promotion left uncovered', async () => {
      promotions.getActiveDiscountedProductPromotions.mockReturnValue(
        of([
          {
            id: 'pr',
            name: 'P',
            isActive: true,
            startDate: null,
            endDate: null,
            items: [{ productId: 'p1', fixedPrice: 10, addOns: [{ addOnProductId: 'a1', quantity: 1 }] }],
          },
        ]),
      );
      const addOns = [orderItem({ id: 'x', productId: 'a1', productName: 'Cheese', quantity: 1, price: 0 })];
      await create(
        makeOrder({
          status: OrderStatusEnum.Pending,
          items: [
            orderItem({ id: 'covered', quantity: 1, addOns, discountPromotionId: 'pr' }),
            orderItem({ id: 'rest', quantity: 1, addOns }),
          ],
        }),
      );
      const [covered, rest] = t.detailItems();
      expect(covered.promoDiscount).toBe(10);
      expect(rest.promoDiscount).toBeUndefined();
    });

    it('shows the order note in its own box, and no box without a note', async () => {
      await create(makeOrder({ specialInstructions: ' Pack separately ' }));
      expect(fixture.nativeElement.textContent).toContain('Order note');
      expect(fixture.nativeElement.textContent).toContain('Pack separately');

      await create(makeOrder({ specialInstructions: '  ' }));
      expect(fixture.nativeElement.textContent).not.toContain('Order note');
    });

    it('does not invent a promo for a finished order that has none stored', async () => {
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
      for (const status of [OrderStatusEnum.Completed, OrderStatusEnum.Cancelled, OrderStatusEnum.Refunded]) {
        await create(
          makeOrder({
            status,
            items: [
              orderItem({
                addOns: [orderItem({ id: 'x', productId: 'a1', productName: 'Cheese', quantity: 1, price: 0 })],
              }),
            ],
          }),
        );
        const line = t.detailItems()[0];
        expect(line.promoDiscount).toBeUndefined();
        expect(line.promoLabel).toBeUndefined();
      }
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
          status: OrderStatusEnum.Pending,
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
          status: OrderStatusEnum.Pending,
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

    it('getItemTotal and getBreakdown', () => {
      const item: CartItemDto = {
        productId: 'p',
        name: 'P',
        price: 10,
        qty: 2,
        addOns: [{ addOnId: 'a', name: 'A', price: 2 }],
      };
      expect(t.getItemTotal(item)).toBe(24);
      expect(t.getBreakdown(item).rows.map((r) => [r.kind, r.amount])).toEqual([
        ['base', 20],
        ['addOn', 4],
      ]);
      expect(t.getBreakdown(item).total).toBe(24);
      const bundle: CartItemDto = {
        ...item,
        bundleItems: [{ productId: 'c', name: 'c', price: 0, qty: 1 }],
      };
      expect(t.getItemTotal(bundle)).toBe(20);
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

    it('sorts bundle items and builds the breakdown rows', () => {
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
      const rows = t.getBreakdown(line).rows;
      expect(rows.map((r) => r.label)).toEqual(['Price', 'Large', 'Cheese']);
      expect(rows[1]).toMatchObject({ amount: 2, detail: '₱1.00 each' });
      expect(rows[2]).toMatchObject({ amount: 20, detail: '₱5.00 × 4 (2 per item)' });
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

  describe('offline orders held for review', () => {
    const held = (over: Partial<OrderDto> = {}) =>
      makeOrder({
        orderNumber: 21,
        status: OrderStatusEnum.PendingReview,
        totalAmount: 150,
        reviewReasons: 'Latte now costs 160.00, quoted 150.00.\nOat Milk is inactive.',
        ...over,
      });

    const el = () => fixture.nativeElement as HTMLElement;
    const box = () => el().querySelector('[data-held-order]') as HTMLElement | null;
    const button = (label: string) =>
      [...(box()?.querySelectorAll('button') ?? [])].find((b) =>
        b.textContent?.trim().startsWith(label),
      ) as HTMLButtonElement | undefined;
    const held$ = () =>
      t as unknown as {
        canReviewHeld: () => boolean;
        approveOrder: () => void;
        askRejectOrder: () => void;
        confirmRejectOrder: (reason: string) => void;
        getStatusLabel: (status: OrderStatusEnum) => string;
        getStatusVariant: (status: OrderStatusEnum) => string;
      };

    it('shows why it is held and what an Admin can do', async () => {
      await create(held());

      expect(box()!.textContent).toContain('Needs review');
      expect(box()!.textContent).toContain('Latte now costs 160.00, quoted 150.00.');
      expect(box()!.textContent).toContain('Oat Milk is inactive.');
      expect(button('Approve')).toBeDefined();
      expect(button('Reject')).toBeDefined();
      expect(held$().getStatusLabel(OrderStatusEnum.PendingReview)).toBe('Needs review');
      expect(held$().getStatusVariant(OrderStatusEnum.PendingReview)).toBe('amber');
    });

    it('has no box on an ordinary order', async () => {
      await create(makeOrder({ status: OrderStatusEnum.Completed }));

      expect(box()).toBeNull();
    });

    it('leaves the decision to an Admin: others see the reasons but no buttons', async () => {
      canOverride.mockReturnValue(false);
      await create(held());

      expect(box()!.textContent).toContain('An Admin has to approve or reject it.');
      expect(button('Approve')).toBeUndefined();
      expect(button('Reject')).toBeUndefined();
      expect(held$().canReviewHeld()).toBe(false);
      held$().approveOrder();
      expect(orderService.approveHeldOrder).not.toHaveBeenCalled();
    });

    it('approves it and shows the completed order', async () => {
      orderService.approveHeldOrder.mockReturnValue(
        of(makeOrder({ orderNumber: 21, status: OrderStatusEnum.Completed })),
      );
      await create(held());

      button('Approve')!.click();
      fixture.detectChanges();

      expect(orderService.approveHeldOrder).toHaveBeenCalledWith('o1');
      expect(orderService.approveOrder).not.toHaveBeenCalled();
      expect(alert['success']).toHaveBeenCalledWith('Order #21 approved.');
      expect(box()).toBeNull();
    });

    it('rejects it with a reason, through the held-order endpoint', async () => {
      orderService.rejectHeldOrder.mockReturnValue(
        of(makeOrder({ orderNumber: 21, status: OrderStatusEnum.Cancelled })),
      );
      await create(held());

      held$().askRejectOrder();
      fixture.detectChanges();
      expect(el().querySelector('app-reject-order-dialog')!.textContent).toContain(
        'Voids and Refunds report',
      );
      held$().confirmRejectOrder('Wrong price');
      fixture.detectChanges();

      expect(orderService.rejectHeldOrder).toHaveBeenCalledWith('o1', 'Wrong price');
      expect(orderService.rejectOrder).not.toHaveBeenCalled();
      expect(alert['success']).toHaveBeenCalledWith('Order #21 rejected.');
    });
  });

  describe('orders placed through a customer link', () => {
    const online = (over: Partial<OrderDto> = {}) =>
      makeOrder({
        status: OrderStatusEnum.PendingApproval,
        source: OrderSourceEnum.CustomerLink,
        fulfillmentType: FulfillmentTypeEnum.Delivery,
        deliveryAddress: '5 Side St',
        contactNumber: '0917 123 4567',
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 500,
        changeAmount: 140,
        customerName: 'Maria Cruz',
        totalAmount: 360,
        ...over,
      });

    const el = () => fixture.nativeElement as HTMLElement;
    const box = () => el().querySelector('[data-online-order]') as HTMLElement | null;
    const button = (label: string) =>
      [...el().querySelectorAll('button')].find((b) =>
        b.textContent?.trim().startsWith(label),
      ) as HTMLButtonElement | undefined;
    const dialog = () => el().querySelector('app-reject-order-dialog') as HTMLElement | null;
    const online$ = () =>
      t as unknown as {
        isOnlineOrder: () => boolean;
        isAwaitingApproval: () => boolean;
        canDecide: () => boolean;
        isDeciding: () => boolean;
        order: () => OrderDto | null;
        approveOrder: () => void;
        askRejectOrder: () => void;
        cancelRejectOrder: () => void;
        confirmRejectOrder: (reason: string) => void;
        showRejectDialog: () => boolean;
      };

    describe('chat with the customer', () => {
      const chatButton = () => el().querySelector('[data-chat-button]') as HTMLButtonElement | null;
      const panel = () => el().querySelector('[data-order-chat]') as HTMLElement;
      const router = () => TestBed.inject(Router);

      it('has a Chat button on a customer order, and none on an ordinary POS order', async () => {
        await create(online());
        expect(chatButton()).not.toBeNull();

        await create(makeOrder());
        expect(chatButton()).toBeNull();
      });

      it('shows how many of the customers messages are unread', async () => {
        unreadByOrder['o1'] = 4;
        await create(online());

        expect(chatButton()!.querySelector('[data-chat-unread]')!.textContent!.trim()).toBe('4');
      });

      it('shows no number when nothing is unread', async () => {
        await create(online());

        expect(chatButton()!.querySelector('[data-chat-unread]')).toBeNull();
      });

      it('opens the chat of that order in the side panel, and closes it', async () => {
        await create(online({ orderNumber: 1042 }));
        expect(panel().className).toContain('translate-x-full');

        chatButton()!.click();
        fixture.detectChanges();
        expect(panel().className).toContain('translate-x-0');
        expect(chatApi.getOrderConversation).toHaveBeenCalledWith('o1');

        (el().querySelector('[data-chat-close]') as HTMLElement).click();
        fixture.detectChanges();
        expect(panel().className).toContain('translate-x-full');
      });

      it('opens straight away from a notification (?chat=open), then clears the parameter', async () => {
        const navigate = vi.spyOn(router(), 'navigate').mockResolvedValue(true);
        await create(online());

        queryParams$.next(convertToParamMap({ chat: 'open' }));
        fixture.detectChanges();

        expect(panel().className).toContain('translate-x-0');
        expect(navigate).toHaveBeenCalledWith([], {
          queryParams: { chat: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });

      it('can be opened again by the same link later', async () => {
        vi.spyOn(router(), 'navigate').mockResolvedValue(true);
        await create(online());

        queryParams$.next(convertToParamMap({ chat: 'open' }));
        fixture.detectChanges();
        (el().querySelector('[data-chat-close]') as HTMLElement).click();
        fixture.detectChanges();
        expect(panel().className).toContain('translate-x-full');

        queryParams$.next(convertToParamMap({ chat: 'open' }));
        fixture.detectChanges();
        expect(panel().className).toContain('translate-x-0');
      });

      it('ignores other parameters', async () => {
        const navigate = vi.spyOn(router(), 'navigate').mockResolvedValue(true);
        await create(online());

        queryParams$.next(convertToParamMap({ chat: 'closed', other: '1' }));
        fixture.detectChanges();

        expect(panel().className).toContain('translate-x-full');
        expect(navigate).not.toHaveBeenCalled();
      });
    });

    it('shows how the customer wants it handed over, the address, contact and what they will pay', async () => {
      await create(online());

      const text = box()!.textContent ?? '';
      expect(text).toContain('Online order');
      expect(text).toContain('Delivery');
      expect(text).toContain('5 Side St');
      expect(text).toContain('0917 123 4567');
      expect(text).toContain('Customer will pay');
      expect(text).toContain('500.00');
      expect(text).toContain('140.00');
    });

    it('shows the tip the customer leaves', async () => {
      await create(online({ tips: 20 }));

      expect(box()!.textContent).toContain('Tip');
      expect(box()!.textContent).toContain('20.00');
    });

    it('shows no tip row when there is none', async () => {
      await create(online({ tips: null }));

      expect(box()!.textContent).not.toContain('Tip');
    });

    it('shows pickup without an address', async () => {
      await create(online({ fulfillmentType: FulfillmentTypeEnum.Pickup, deliveryAddress: null }));

      const text = box()!.textContent ?? '';
      expect(text).toContain('Pickup');
      expect(text).not.toContain('Address');
    });

    it('has no online box for an ordinary POS order', async () => {
      await create(makeOrder({ status: OrderStatusEnum.Pending }));

      expect(box()).toBeNull();
      expect(online$().isOnlineOrder()).toBe(false);
    });

    it('labels the status Awaiting approval and says what to do', async () => {
      await create(online());

      expect(t.getStatusLabel(OrderStatusEnum.PendingApproval)).toBe('Awaiting approval');
      expect(t.getStatusVariant(OrderStatusEnum.PendingApproval)).toBe('amber');
      expect(el().textContent).toContain('Awaiting approval');
      expect(el().textContent).toContain('Accept or reject it to continue');
    });

    it('offers Accept and Reject only while it waits, and only to someone who may answer', async () => {
      await create(online());
      expect(button('Accept')).toBeDefined();
      expect(button('Reject')).toBeDefined();
      expect(online$().canDecide()).toBe(true);
    });

    it('hides Accept and Reject without permission to write orders', async () => {
      canWrite = false;
      await create(online());

      expect(button('Accept')).toBeUndefined();
      expect(button('Reject')).toBeUndefined();
      expect(online$().canDecide()).toBe(false);
      online$().approveOrder();
      expect(orderService.approveOrder).not.toHaveBeenCalled();
    });

    it('hides Accept and Reject once the order has been answered', async () => {
      await create(online({ status: OrderStatusEnum.Pending }));

      expect(button('Accept')).toBeUndefined();
      expect(button('Reject')).toBeUndefined();
      expect(box()).not.toBeNull();
    });

    it('shows why a rejected order was turned down', async () => {
      await create(online({ status: OrderStatusEnum.Cancelled, rejectionReason: 'Closed today' }));

      expect(box()!.textContent).toContain('Rejected because');
      expect(box()!.textContent).toContain('Closed today');
    });

    it('accepts the order and shows it as pending afterwards', async () => {
      orderService.approveOrder.mockReturnValue(
        of(online({ status: OrderStatusEnum.Pending })),
      );
      await create(online());

      button('Accept')!.click();
      await flush();

      expect(orderService.approveOrder).toHaveBeenCalledWith('o1');
      expect(online$().order()!.status).toBe(OrderStatusEnum.Pending);
      expect(alert['success']).toHaveBeenCalledWith('Order #12 accepted.');
      expect(button('Accept')).toBeUndefined();
    });

    it('blocks double clicks while accepting', async () => {
      orderService.approveOrder.mockReturnValue(new Subject());
      await create(online());

      button('Accept')!.click();
      fixture.detectChanges();

      expect(el().textContent).toContain('Accepting...');
      expect(online$().isDeciding()).toBe(true);
      online$().approveOrder();
      expect(orderService.approveOrder).toHaveBeenCalledTimes(1);
      expect(button('Reject')!.disabled).toBe(true);
    });

    it('shows the error and reloads the order when it cannot be accepted', async () => {
      orderService.approveOrder.mockReturnValue(
        throwError(() => new Error('This order is no longer waiting for approval.')),
      );
      await create(online());
      orderService.getOrder.mockClear();
      orderService.getOrder.mockReturnValue(of(online({ status: OrderStatusEnum.Cancelled })));

      button('Accept')!.click();
      await flush();

      expect(alert['error']).toHaveBeenCalledWith('This order is no longer waiting for approval.');
      expect(orderService.getOrder).toHaveBeenCalledTimes(1);
      expect(online$().isDeciding()).toBe(false);
    });

    it('asks for a reason before rejecting, then rejects and shows the reason', async () => {
      orderService.rejectOrder.mockReturnValue(
        of(online({ status: OrderStatusEnum.Cancelled, rejectionReason: 'Closed' })),
      );
      await create(online());

      button('Reject')!.click();
      fixture.detectChanges();
      expect(dialog()).not.toBeNull();
      expect(dialog()!.textContent).toContain('Reject Order #12?');
      expect(orderService.rejectOrder).not.toHaveBeenCalled();

      online$().confirmRejectOrder('Closed');
      await flush();

      expect(orderService.rejectOrder).toHaveBeenCalledWith('o1', 'Closed');
      expect(dialog()).toBeNull();
      expect(online$().order()!.status).toBe(OrderStatusEnum.Cancelled);
      expect(box()!.textContent).toContain('Closed');
      expect(alert['success']).toHaveBeenCalledWith('Order #12 rejected.');
    });

    it('can cancel the reject dialog, but not while a rejection is being sent', async () => {
      orderService.rejectOrder.mockReturnValue(new Subject());
      await create(online());

      online$().askRejectOrder();
      online$().cancelRejectOrder();
      expect(online$().showRejectDialog()).toBe(false);

      online$().askRejectOrder();
      online$().confirmRejectOrder('Closed');
      online$().cancelRejectOrder();
      expect(online$().showRejectDialog()).toBe(true);
      online$().confirmRejectOrder('Closed again');
      expect(orderService.rejectOrder).toHaveBeenCalledTimes(1);
    });

    it('shows the error, closes the dialog and reloads when the rejection fails', async () => {
      orderService.rejectOrder.mockReturnValue(throwError(() => new Error('nope')));
      await create(online());
      orderService.getOrder.mockClear();

      online$().askRejectOrder();
      online$().confirmRejectOrder('Closed');
      await flush();

      expect(alert['error']).toHaveBeenCalledWith('nope');
      expect(online$().showRejectDialog()).toBe(false);
      expect(orderService.getOrder).toHaveBeenCalledTimes(1);
    });

    it('cannot start a reject without permission', async () => {
      canWrite = false;
      await create(online());

      online$().askRejectOrder();
      expect(online$().showRejectDialog()).toBe(false);
    });
  });
});
