import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  CartPersistenceService,
  CatalogCacheService,
  ConnectivityService,
  ConversationInboxService,
  ConversationService,
  CustomerService,
  ModalStackService,
  OfflineOrderService,
  OrderService,
  ProductService,
  PromotionService,
  SignalRService,
  StockLimitsService,
} from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';
import {
  AddOnGroupDto,
  AddOnTypeEnum,
  CartAddOnDto,
  CartItemDto,
  CustomerDto,
  DiscountedProductPromotionDto,
  OrderDto,
  FulfillmentTypeEnum,
  OrderSourceEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
  ProductCategoryEnum,
  ProductDto,
  ProductSubCategoryEnum,
  PromotionListItemDto,
  PromotionTypeEnum,
} from '@shared/models';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderEditor } from './order-editor';

interface Sig<T> {
  (): T;
  set: (v: T) => void;
}

interface Editor {
  cart: Sig<CartItemDto[]>;
  customers: Sig<CustomerDto[]>;
  products: () => ProductDto[];
  productsCache: Sig<ProductDto[]>;
  bundlePromotions: Sig<PromotionListItemDto[]>;
  discountedProductPromotions: Sig<DiscountedProductPromotionDto[]>;
  selectedCustomerId: Sig<string | null>;
  orderSpecialInstructions: Sig<string>;
  isEditMode: Sig<boolean>;
  isOfflineEditMode: () => boolean;
  isOverrideMode: Sig<boolean>;
  stockMessages: () => { itemId: string; text: string; lineKeys: string[] }[];
  stockBlocksCheckout: () => boolean;
  stockNotesForLine: (index: number) => string[];
  isLoading: () => boolean;
  isSavingOrder: Sig<boolean>;
  isCancellingOrder: Sig<boolean>;
  isRefreshing: () => boolean;
  currentOrder: Sig<OrderDto | null>;
  offlineOrderStatus: Sig<OrderStatusEnum | null>;
  activeCatalogTab: () => string;
  activeSubCategoryTab: () => ProductSubCategoryEnum;
  showAbandonModal: () => boolean;
  showCancelOrderModal: () => boolean;
  cancelOrderNote: () => string;
  showCancelOrderNoteError: () => boolean;
  showOverrideModal: () => boolean;
  overrideReason: () => string;
  showOverrideReasonError: () => boolean;
  showCreateCustomerModal: () => boolean;
  isCreatingCustomer: () => boolean;
  showDiscardOrderModal: () => boolean;
  showMobileCart: () => boolean;
  isCartCollapsed: () => boolean;
  isRailTriggerHovering: () => boolean;
  cartDragY: () => number;
  isCartDragging: () => boolean;
  isQuickPayHolding: () => boolean;
  quickPayProgress: () => number;
  isReadOnly: () => boolean;
  isCompleted: () => boolean;
  isCancellable: () => boolean;
  isOfflineCompleted: () => boolean;
  canEditOrderSpecialInstructions: () => boolean;
  canEditCustomerSelection: () => boolean;
  selectedCustomerName: () => string;
  customerOptions: () => { id: string; label: string }[];
  receiptData: () => {
    orderNumber: number | null;
    orderLabel: string | null;
    customerName: string;
    status: OrderStatusEnum;
    totalAmount: number;
    specialInstructions: string;
  };
  receiptTotalAmount: () => number;
  paymentAmountPaid: () => number;
  paymentTotalPaid: () => number;
  paymentOrderTotal: () => number;
  paymentTipsAmount: () => number;
  paymentChangeAmount: () => number;
  categoryCounts: () => Record<number, number>;
  checkoutCartItems: () => CartItemDto[];
  productsBySubCategory: () => Record<number, ProductDto[]>;
  visibleSubCategoryTabs: () => { id: ProductSubCategoryEnum }[];
  filteredBundlePromotions: () => PromotionListItemDto[];
  filteredDeals: () => { title: string; price: number; listPrice: number; label: string | null }[];
  hasPromos: () => boolean;
  addDealToCart: (d: unknown) => void;
  filterForm: { controls: { searchTerm: { setValue: (v: string) => void } } };
  itemCount: () => number;
  totalPrice: () => number;
  getNameParts: (n: string) => { text: string; isMatch: boolean }[];
  selectSubCategoryTab: (t: ProductSubCategoryEnum) => void;
  selectCatalogTab: (t: 'products' | 'bundles') => void;
  onCartDragStart: (e: TouchEvent) => void;
  onCartDragMove: (e: TouchEvent) => void;
  onCartDragEnd: () => void;
  toggleCartCollapse: () => void;
  onRailTriggerLeave: () => void;
  startQuickPayHold: () => void;
  cancelQuickPayHold: () => void;
  openMobileCart: () => void;
  closeMobileCart: () => void;
  onOrderSpecialInstructionsInput: (e: Event) => void;
  refreshProducts: () => void;
  addToCart: (p: ProductDto) => void;
  addBundlePromotionToCart: (p: PromotionListItemDto) => void;
  onAddonSelected: (e: {
    product: ProductDto;
    addOns: CartAddOnDto[];
    quantity: number;
    specialInstructions?: string | null;
    editIndex?: number | null;
  }) => void;
  getDiscountedUnitPrice: (i: CartItemDto) => number | null;
  getLineDiscount: (item: CartItemDto) => { price: number; quantity: number } | null;
  getPartialDiscountNote: (item: CartItemDto) => string | null;
  buildOrderItemsFromCart: (withQuotes?: boolean) => Record<string, unknown>[];
  getUnitSubtotal: (i: CartItemDto) => number;
  getLineTotal: (i: CartItemDto) => number;
  getDiscountedAmount: (i: CartItemDto) => number;
  getDiscountedPromoLabel: (i: CartItemDto) => string | null;
  getBundleChildTotalQuantity: (
    l: CartItemDto,
    c: { productId: string; name: string; price: number; qty: number },
  ) => number;
  getSortedBundleItems: (i: CartItemDto) => { name: string }[];
  getBreakdown: (i: CartItemDto) => { rows: { kind: string; label: string; detail: string | null; amount: number }[]; total: number };
  increment: (id: string, index: number) => void;
  decrement: (id: string, index: number) => void;
  clearAll: () => void;
  editCartItem: (index: number) => void;
  onCustomerSelected: (id: string | null) => void;
  getCustomerDisplayName: (c: CustomerDto) => string;
  getPaymentMethodLabel: (m?: PaymentMethodEnum | null) => string;
  getStatusVariant: (s?: OrderStatusEnum | null) => string;
  getStatusLabel: (s?: OrderStatusEnum | null) => string;
  getOrderDateValue: (o: OrderDto) => string;
  downloadOrderImage: () => Promise<void>;
  openCreateCustomerModal: () => void;
  closeCreateCustomerModal: () => void;
  saveCustomerFromModal: () => void;
  createCustomerForm: {
    patchValue: (v: object) => void;
    controls: { firstName: { setValue: (v: string) => void } };
  };
  cancel: () => void;
  canDeactivate: () => boolean | Promise<boolean>;
  confirmAbandon: () => void;
  cancelAbandon: () => void;
  openCancelOrderModal: () => void;
  onCancelOrderNoteInput: (e: Event) => void;
  confirmCancelOrder: () => void;
  dismissCancelOrder: () => void;
  cancelOverride: () => void;
  onOverrideReasonInput: (e: Event) => void;
  dismissOverride: () => void;
  confirmOverride: () => void;
  openDiscardOrderModal: () => void;
  confirmDiscardOrder: () => void;
  dismissDiscardOrder: () => void;
  checkout: () => void;
  onOrderSaved: () => void;
  onOrderConfirmed: (e: {
    paymentMethod: PaymentMethodEnum;
    amountReceived?: number;
    changeAmount?: number;
    tips?: number;
  }) => void;
  onCatalogContentScrolled: (e: Event) => void;
}

const product = (over: Partial<ProductDto> & { id: string }): ProductDto => ({
  name: over.id,
  code: over.id,
  description: null,
  price: 100,
  category: ProductCategoryEnum.Drink,
  subCategory: ProductSubCategoryEnum.Coffee,
  isAddOn: false,
  isActive: true,
  createdAt: '',
  createdBy: '',
  updatedAt: null,
  updatedBy: null,
  imageUrl: null,
  priceHistory: [],
  addOnCount: 0,
  overridePrice: null,
  ...over,
});

const P_LATTE = product({ id: 'latte', name: 'Latte', price: 100 });
const P_MOCHA = product({ id: 'mocha', name: 'Mocha', price: 120, imageUrl: 'mocha.png' });
const P_COLA = product({
  id: 'cola',
  name: 'Cola',
  price: 50,
  subCategory: ProductSubCategoryEnum.NonCoffee,
});
const P_CHIPS = product({
  id: 'chips',
  name: 'Chips',
  price: 30,
  category: ProductCategoryEnum.Food,
  subCategory: ProductSubCategoryEnum.Snacks,
});
const P_SHOT = product({ id: 'shot', name: 'Shot', price: 20, isAddOn: true, subCategory: null });
const ALL_PRODUCTS = [P_LATTE, P_MOCHA, P_COLA, P_CHIPS, P_SHOT];

const shotAddOn = (): CartAddOnDto => ({
  addOnId: 'shot',
  name: 'Shot',
  price: 20,
  addOnType: AddOnTypeEnum.Extra,
});

const line = (over: Partial<CartItemDto> = {}): CartItemDto => ({
  productId: 'latte',
  name: 'Latte',
  price: 100,
  qty: 1,
  ...over,
});

const order = (over: Partial<OrderDto> = {}): OrderDto => ({
  id: 'o1',
  orderNumber: 5,
  createdAt: '2026-01-02T10:00:00Z',
  createdBy: 'u',
  items: [],
  status: OrderStatusEnum.Pending,
  totalAmount: 0,
  ...over,
});

const cash = {
  paymentMethod: PaymentMethodEnum.Cash,
  amountReceived: 500,
  changeAmount: 300,
  tips: 10,
};

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

describe('OrderEditor', () => {
  let fixture: ComponentFixture<OrderEditor>;
  let t: Editor;
  let router: Router;
  let nav: ReturnType<typeof vi.spyOn>;
  let params: Record<string, string>;
  let query: Record<string, string>;
  let queryParams$: BehaviorSubject<ParamMap>;
  let unreadByOrder: Record<string, number>;
  let inbox: { unreadFor: ReturnType<typeof vi.fn> };
  let chatApi: { getOrderConversation: ReturnType<typeof vi.fn> };
  let chatHub: {
    orderMessage: Observable<unknown>;
    startStaffOrdersHub: ReturnType<typeof vi.fn>;
    stopStaffOrdersHub: ReturnType<typeof vi.fn>;
  };
  let isOnline: ReturnType<typeof signal<boolean>>;
  let limitItems: ReturnType<typeof signal<{ id: string; name: string; unitName: string; balance: number }[]>>;
  let limitLinks: ReturnType<typeof signal<{ productId: string; itemId: string; quantityPerSale: number }[]>>;
  let stockLimits: {
    items: typeof limitItems;
    links: typeof limitLinks;
    sizeMultipliers: () => { productId: string; multiplier: number }[];
    hasBlockingItems: () => boolean;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };
  let canWrite: boolean;
  let canOverride: boolean;
  let canCreateCustomer: boolean;
  let authenticated: boolean;

  let alert: Record<string, ReturnType<typeof vi.fn>>;
  let orderService: Record<string, ReturnType<typeof vi.fn>>;
  let promotionService: Record<string, ReturnType<typeof vi.fn>>;
  let productService: { getProducts: ReturnType<typeof vi.fn> };
  let customerService: Record<string, ReturnType<typeof vi.fn>>;
  let persistence: Record<string, ReturnType<typeof vi.fn>>;
  let offline: Record<string, ReturnType<typeof vi.fn>>;
  let catalog: {
    load: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    products: ReturnType<typeof signal<ProductDto[]>>;
    customers: ReturnType<typeof signal<CustomerDto[]>>;
    bundlePromotions: ReturnType<typeof signal<PromotionListItemDto[]>>;
    getAddOnsForProduct: ReturnType<typeof vi.fn>;
    getFixedBundle: ReturnType<typeof vi.fn>;
    getMixMatch: ReturnType<typeof vi.fn>;
    discountedPromotions: ReturnType<typeof vi.fn>;
  };
  let modalStack: ModalStackService;
  let selectorOpen: ReturnType<typeof vi.spyOn>;
  let checkoutOpen: ReturnType<typeof vi.spyOn>;
  let checkoutClose: ReturnType<typeof vi.spyOn>;

  const customerJane: CustomerDto = {
    id: 'c1',
    firstName: 'Jane',
    lastName: 'Doe',
    isActive: true,
    createdAt: '',
    createdBy: '',
    allowOrderingLink: false,
  };

  const bundlePromo = (over: Partial<PromotionListItemDto> = {}): PromotionListItemDto => ({
    id: 'b1',
    name: 'Combo',
    typeId: PromotionTypeEnum.FixedBundle,
    isActive: true,
    startDate: null,
    endDate: null,
    bundlePrice: 150,
    ...over,
  });

  const fixedBundleDto = () => ({
    id: 'b1',
    name: 'Combo',
    isActive: true,
    startDate: null,
    endDate: null,
    bundlePrice: 150,
    items: [
      { productId: 'latte', quantity: 1, addOns: [{ addOnProductId: 'shot', quantity: 2 }] },
      { productId: 'chips', quantity: 2, addOns: [] },
    ],
  });

  const mixMatchDto = () => ({
    id: 'm1',
    name: 'Mix',
    isActive: true,
    startDate: null,
    endDate: null,
    requiredQuantity: 2,
    maxSelectionsPerOrder: 3,
    bundlePrice: 200,
    items: [
      { productId: 'latte', addOns: [] },
      { productId: 'cola', addOns: [] },
    ],
  });

  const start = async () => {
    fixture = TestBed.createComponent(OrderEditor);
    t = fixture.componentInstance as unknown as Editor;
    const inst = fixture.componentInstance as unknown as {
      addonSelector: () => { open: (...a: unknown[]) => void };
      checkoutModal: () => { triggerOpen: () => void; close: () => void };
    };
    fixture.detectChanges();
    selectorOpen = vi.spyOn(inst.addonSelector(), 'open').mockImplementation(() => undefined);
    checkoutOpen = vi.spyOn(inst.checkoutModal(), 'triggerOpen').mockImplementation(() => undefined);
    checkoutClose = vi.spyOn(inst.checkoutModal(), 'close').mockImplementation(() => undefined);
    await settle();
    fixture.detectChanges();
  };

  const withCart = (items: CartItemDto[]) => {
    t.cart.set(items);
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    params = {};
    query = {};
    isOnline = signal(true);
    limitItems = signal([]);
    limitLinks = signal([]);
    stockLimits = {
      items: limitItems,
      links: limitLinks,
      sizeMultipliers: () => [],
      hasBlockingItems: () => limitItems().length > 0,
      start: vi.fn(),
      stop: vi.fn(),
      load: vi.fn(() => of({ items: limitItems(), links: limitLinks(), asOf: '' })),
    };
    canWrite = true;
    canOverride = true;
    canCreateCustomer = true;
    authenticated = true;
    alert = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
      errorUnauthorized: vi.fn(),
      successCreated: vi.fn(),
      getLoadErrorMessage: vi.fn((e: string) => `load ${e} failed`),
      getCreateErrorMessage: vi.fn((e: string) => `create ${e} failed`),
      getUpdateErrorMessage: vi.fn((e: string) => `update ${e} failed`),
    };
    orderService = {
      getOrder: vi.fn(),
      createOrder: vi.fn().mockReturnValue(of(order())),
      updateOrder: vi.fn().mockReturnValue(of(order())),
      overrideOrder: vi.fn().mockReturnValue(of(order())),
      voidOrder: vi.fn().mockReturnValue(of(order())),
      markOrderReady: vi.fn(),
    };
    promotionService = {
      getActiveDiscountedProductPromotions: vi.fn().mockReturnValue(of([])),
      getMixMatchPromotion: vi.fn().mockReturnValue(of(mixMatchDto())),
      getFixedBundle: vi.fn().mockReturnValue(of(fixedBundleDto())),
    };
    productService = { getProducts: vi.fn().mockReturnValue(of(ALL_PRODUCTS)) };
    customerService = {
      getCustomers: vi.fn().mockReturnValue(of([customerJane])),
      createCustomer: vi.fn().mockReturnValue(of({ ...customerJane, id: 'c2', firstName: 'New' })),
    };
    persistence = {
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    };
    offline = {
      queue: vi.fn().mockResolvedValue('OFF-1'),
      update: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      lockSyncForOfflineEdit: vi.fn(),
      unlockSyncForOfflineEdit: vi.fn(),
    };
    catalog = {
      load: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      products: signal<ProductDto[]>(ALL_PRODUCTS),
      customers: signal<CustomerDto[]>([customerJane]),
      bundlePromotions: signal<PromotionListItemDto[]>([]),
      getAddOnsForProduct: vi.fn().mockReturnValue([]),
      getFixedBundle: vi.fn().mockReturnValue(undefined),
      getMixMatch: vi.fn().mockReturnValue(undefined),
      discountedPromotions: vi.fn().mockReturnValue([]),
    };

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
    chatHub = {
      orderMessage: new Subject<unknown>().asObservable(),
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
              return {
                paramMap: convertToParamMap(params),
                queryParamMap: convertToParamMap(query),
              };
            },
            queryParamMap: queryParams$.asObservable(),
          },
        },
        { provide: ConversationInboxService, useValue: inbox },
        { provide: ConversationService, useValue: chatApi },
        { provide: SignalRService, useValue: chatHub },
        { provide: AlertService, useValue: alert },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => authenticated,
            canWriteOrders: () => canWrite,
            canOverrideOrders: () => canOverride,
            canCreateCustomerInOrder: () => canCreateCustomer,
          },
        },
        { provide: OrderService, useValue: orderService },
        { provide: PromotionService, useValue: promotionService },
        { provide: ProductService, useValue: productService },
        { provide: CustomerService, useValue: customerService },
        { provide: CartPersistenceService, useValue: persistence },
        { provide: OfflineOrderService, useValue: offline },
        { provide: CatalogCacheService, useValue: catalog },
        { provide: ConnectivityService, useValue: { isOnline } },
        { provide: StockLimitsService, useValue: stockLimits },
      ],
    });
    router = TestBed.inject(Router);
    nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    modalStack = TestBed.inject(ModalStackService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('new order: catalog and persistence', () => {
    it('loads catalog, splits products by sub category and counts categories', async () => {
      await start();
      expect(catalog.load).toHaveBeenCalled();
      expect(t.isLoading()).toBe(false);
      expect(t.products().length).toBe(5);
      expect(t.productsBySubCategory()[ProductSubCategoryEnum.Coffee].map((p) => p.id)).toEqual([
        'latte',
        'mocha',
      ]);
      expect(t.visibleSubCategoryTabs().map((x) => x.id)).toEqual([1, 2, 3]);
      expect(t.categoryCounts()).toEqual({
        [ProductCategoryEnum.Drink]: 4,
        [ProductCategoryEnum.Food]: 1,
      });
      expect(t.customers().length).toBe(1);
      expect(t.isEditMode()).toBe(false);
    });

    it('restores a saved cart and enriches images from the catalog', async () => {
      persistence['load'].mockResolvedValue({
        items: [line({ productId: 'mocha', name: 'Mocha', price: 120, imageUrl: 'stale-blob' })],
        customerId: 'c1',
        specialInstructions: 'less ice',
        savedAt: '',
      });
      await start();
      expect(t.cart().length).toBe(1);
      expect(t.cart()[0].imageUrl).toBe('mocha.png');
      expect(t.selectedCustomerId()).toBe('c1');
      expect(t.orderSpecialInstructions()).toBe('less ice');
    });

    it('does not overwrite with empty cart before restore completes, saves afterwards', async () => {
      await start();
      TestBed.tick();
      expect(persistence['save']).not.toHaveBeenCalled();

      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 1 });
      TestBed.tick();
      expect(persistence['save']).toHaveBeenCalledWith(t.cart(), null, '');

      t.clearAll();
      TestBed.tick();
      expect(persistence['clear']).toHaveBeenCalled();
    });

    it('filters products by search term after debounce and keeps a visible tab', async () => {
      await start();
      vi.useFakeTimers();
      t.filterForm.controls.searchTerm.setValue('cola');
      vi.advanceTimersByTime(300);
      expect(t.products().map((p) => p.id)).toEqual(['cola']);
      expect(t.activeSubCategoryTab()).toBe(ProductSubCategoryEnum.NonCoffee);
    });

    it('highlights search matches in names', async () => {
      await start();
      expect(t.getNameParts('Latte')).toEqual([{ text: 'Latte', isMatch: false }]);
      t.filterForm.controls.searchTerm.setValue('at');
      expect(t.getNameParts('Latte')).toEqual([
        { text: 'L', isMatch: false },
        { text: 'at', isMatch: true },
        { text: 'te', isMatch: false },
      ]);
      expect(t.getNameParts('Chips')).toEqual([{ text: 'Chips', isMatch: false }]);
    });

    describe('product cards', () => {
      const cards = () =>
        [...(fixture.nativeElement as HTMLElement).querySelectorAll('.card')].filter((c) =>
          c.className.includes('min-h-60'),
        ) as HTMLElement[];
      const cardOf = (name: string) =>
        cards().find((c) => c.querySelector('h2')?.textContent?.includes(name)) as HTMLElement;

      it('shows the product description under the name, like the public page', async () => {
        catalog.products.set([
          { ...P_LATTE, description: 'Espresso with steamed milk' },
          { ...P_COLA, description: null },
        ]);
        await start();

        const latte = cardOf('Latte');
        expect(latte.textContent).toContain('Espresso with steamed milk');
        const description = [...latte.querySelectorAll('p')].find((p) =>
          p.textContent?.includes('Espresso'),
        ) as HTMLElement;
        expect(description.className).toContain('line-clamp-2');
        expect(description.className).toContain('text-xs');
        expect(description.previousElementSibling!.tagName).toBe('H2');
      });

      it('keeps the price at the bottom of the card with or without a description', async () => {
        catalog.products.set([
          { ...P_LATTE, description: 'Espresso with steamed milk' },
          { ...P_COLA, description: null },
        ]);
        await start();

        for (const name of ['Latte', 'Cola']) {
          const actions = cardOf(name).querySelector('.card-actions') as HTMLElement;
          expect(actions.className).toContain('mt-auto');
          expect(actions.closest('.card-body')!.className).toContain('justify-between');
        }
        expect(cardOf('Cola').querySelectorAll('p').length).toBe(0);
      });

      it('clamps a long description to two lines', async () => {
        catalog.products.set([{ ...P_LATTE, description: 'word '.repeat(200) }]);
        await start();

        expect(cardOf('Latte').querySelector('p')!.className).toContain('line-clamp-2');
      });
    });

    it('refreshProducts re-pulls catalog', async () => {
      await start();
      catalog.products.set([P_LATTE]);
      t.refreshProducts();
      expect(t.isRefreshing()).toBe(true);
      await settle();
      expect(catalog.refresh).toHaveBeenCalled();
      expect(t.products().map((p) => p.id)).toEqual(['latte']);
      expect(t.isRefreshing()).toBe(false);
    });

    it('loads discounted promotions; failure yields empty list', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        throwError(() => new Error('x')),
      );
      await start();
      expect(t.discountedProductPromotions()).toEqual([]);
    });

    it('syncs bundle promotions from catalog cache', async () => {
      catalog.bundlePromotions.set([bundlePromo()]);
      await start();
      TestBed.tick();
      expect(t.bundlePromotions().length).toBe(1);
    });
  });

  describe('catalog tabs', () => {
    it('selects sub category tabs only if they have products', async () => {
      await start();
      t.selectSubCategoryTab(ProductSubCategoryEnum.Retail);
      expect(t.activeSubCategoryTab()).toBe(ProductSubCategoryEnum.Coffee);
      t.selectSubCategoryTab(ProductSubCategoryEnum.Snacks);
      expect(t.activeSubCategoryTab()).toBe(ProductSubCategoryEnum.Snacks);
    });

    it('bundles tab only available with active bundles', async () => {
      catalog.bundlePromotions.set([
        bundlePromo(),
        bundlePromo({ id: 'b2', name: 'Old', endDate: '2000-01-01T00:00:00Z' }),
        bundlePromo({ id: 'b3', name: 'Off', isActive: false }),
        bundlePromo({ id: 'b4', name: 'Future', startDate: '2999-01-01T00:00:00Z' }),
        bundlePromo({ id: 'b5', name: 'Bad', startDate: 'nonsense' }),
        bundlePromo({ id: 'b6', name: 'Bad2', endDate: 'nonsense' }),
      ]);
      await start();
      TestBed.tick();
      expect(t.filteredBundlePromotions().map((p) => p.id)).toEqual(['b1']);
      t.selectCatalogTab('bundles');
      expect(t.activeCatalogTab()).toBe('bundles');
      t.selectCatalogTab('products');
      expect(t.activeCatalogTab()).toBe('products');
    });

    it('filters bundle promotions by the search term (after the 300ms debounce)', async () => {
      catalog.bundlePromotions.set([bundlePromo()]);
      await start();
      TestBed.tick();
      expect(t.filteredBundlePromotions().length).toBe(1);
      vi.useFakeTimers();
      try {
        t.filterForm.controls.searchTerm.setValue('zzz');
        vi.advanceTimersByTime(300);
        expect(t.filteredBundlePromotions()).toEqual([]);
        t.filterForm.controls.searchTerm.setValue('');
        vi.advanceTimersByTime(300);
        expect(t.filteredBundlePromotions().length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('promo deals', () => {
    const SIZE_SMALL: ProductDto = product({ id: 'small', name: 'Small', price: 0, isAddOn: true });
    const group = {
      type: AddOnTypeEnum.Size,
      displayName: 'Size',
      options: [{ ...SIZE_SMALL, overridePrice: 5 }],
    };
    const promo = (items: object[], extra: object = {}) => [
      {
        id: 'd',
        name: 'D',
        isActive: true,
        startDate: null,
        endDate: null,
        items,
        ...extra,
      },
    ];

    const latteWithSmall = () =>
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promo([{ productId: 'latte', fixedPrice: 30, addOns: [{ addOnProductId: 'small', quantity: 1 }] }])),
      );

    beforeEach(() => {
      catalog.getAddOnsForProduct.mockImplementation((id: string) => (id === 'latte' ? [group] : []));
    });

    it('turns a rule into a card: the product with the add-ons the rule needs, priced as it will be charged', async () => {
      latteWithSmall();
      await start();
      TestBed.tick();

      const deal = t.filteredDeals().at(0)!;
      expect(t.filteredDeals().length).toBe(1);
      expect(deal.title).toBe('Latte + Small');
      expect(deal.listPrice).toBe(105);
      expect(deal.price).toBe(75);
      expect(deal.label).toBe('Promo -₱30.00');
    });

    it('shows a plain-product rule as the product alone', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promo([{ productId: 'latte', percentOff: 10, addOns: [] }])),
      );
      await start();
      TestBed.tick();

      expect(t.filteredDeals().map((d) => [d.title, d.price, d.listPrice])).toEqual([['Latte', 90, 100]]);
    });

    it('a promo with an amount off that covers the price reads Free', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promo([{ productId: 'latte', fixedPrice: 500, addOns: [] }])),
      );
      await start();
      TestBed.tick();

      expect(t.filteredDeals().at(0)!.label).toBe('Free');
      expect(t.filteredDeals().at(0)!.price).toBe(0);
    });

    it('leaves out a rule whose add-on is no longer offered for the product', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promo([{ productId: 'latte', fixedPrice: 30, addOns: [{ addOnProductId: 'gone', quantity: 1 }] }])),
      );
      await start();
      TestBed.tick();

      expect(t.filteredDeals()).toEqual([]);
    });

    it('leaves out a promotion that has no uses left or is closed today', async () => {
      const closed = 1 << ((new Date().getDay() + 1) % 7);
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of([
          ...promo([{ productId: 'latte', percentOff: 10, addOns: [] }], {
            id: 'spent',
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 1, redemptions: 1 },
          }),
          ...promo([{ productId: 'latte', percentOff: 20, addOns: [] }], {
            id: 'closed',
            schedule: { daysOfWeek: closed, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 },
          }),
        ]),
      );
      await start();
      TestBed.tick();

      expect(t.filteredDeals()).toEqual([]);
      expect(t.hasPromos()).toBe(false);
    });

    it('the Promos tab appears for deals alone, and the search narrows the cards', async () => {
      latteWithSmall();
      await start();
      TestBed.tick();

      expect(t.filteredBundlePromotions()).toEqual([]);
      expect(t.hasPromos()).toBe(true);
      t.selectCatalogTab('bundles');
      expect(t.activeCatalogTab()).toBe('bundles');

      vi.useFakeTimers();
      try {
        t.filterForm.controls.searchTerm.setValue('zzz');
        vi.advanceTimersByTime(300);
        expect(t.filteredDeals()).toEqual([]);
        t.filterForm.controls.searchTerm.setValue('latte');
        vi.advanceTimersByTime(300);
        expect(t.filteredDeals().length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('tapping a card opens the selector with the add-ons already chosen and the discount rules', async () => {
      latteWithSmall();
      await start();
      TestBed.tick();

      t.addDealToCart(t.filteredDeals().at(0)!);

      expect(selectorOpen).toHaveBeenCalledTimes(1);
      const [prod, options] = selectorOpen.mock.calls.at(-1) as [
        ProductDto,
        { addOns: { addOnId: string; addOnType: number }[]; promoRules: unknown[] },
      ];
      expect(prod.id).toBe('latte');
      expect(options.addOns).toEqual([
        { addOnId: 'small', name: 'Small', price: 5, addOnType: AddOnTypeEnum.Size },
      ]);
      expect(options.promoRules).toHaveLength(1);
    });

    it('does nothing for a read-only order', async () => {
      latteWithSmall();
      canWrite = false;
      await start();
      TestBed.tick();

      t.addDealToCart(t.filteredDeals().at(0)!);

      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('bundles and deals share the tab', async () => {
      latteWithSmall();
      catalog.bundlePromotions.set([bundlePromo()]);
      await start();
      TestBed.tick();

      expect(t.filteredBundlePromotions().length).toBe(1);
      expect(t.filteredDeals().length).toBe(1);
      expect(t.hasPromos()).toBe(true);
    });
  });

  describe('adding to cart', () => {
    it('addToCart opens the add-on selector with promo info', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of([
          {
            id: 'd',
            name: 'D',
            isActive: true,
            startDate: null,
            endDate: null,
            items: [{ productId: 'latte', fixedPrice: 10, addOns: [] }],
          },
        ]),
      );
      await start();
      t.addToCart(P_LATTE);
      expect(selectorOpen).toHaveBeenCalledWith(P_LATTE, {
        promoRules: [{ fixedPrice: 10, percentOff: null, addOns: [], remaining: null, maxPerOrder: null }],
      });
      t.addToCart(P_COLA);
      expect(selectorOpen).toHaveBeenLastCalledWith(P_COLA, { promoRules: [] });
    });

    it('is blocked without write permission or while busy', async () => {
      canWrite = false;
      await start();
      t.addToCart(P_LATTE);
      expect(selectorOpen).not.toHaveBeenCalled();
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 1 });
      expect(t.cart()).toEqual([]);
    });

    it('is blocked while an order request is running', async () => {
      await start();
      t.isSavingOrder.set(true);
      t.addToCart(P_LATTE);
      t.increment('latte', 0);
      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('adds a new line, stacks plain duplicates, separates add-ons and notes', async () => {
      await start();
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 1 });
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 2 });
      expect(t.cart().map((c) => [c.productId, c.qty])).toEqual([['latte', 3]]);

      t.onAddonSelected({ product: P_LATTE, addOns: [shotAddOn()], quantity: 1 });
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 1, specialInstructions: 'hot' });
      expect(t.cart().length).toBe(3);
      expect(t.cart()[1].addOns).toEqual([shotAddOn()]);
      expect(t.cart()[2].specialInstructions).toBe('hot');
      expect(t.cart()[0].addOns).toBeUndefined();
    });

    it('quantity falls back to 1 when zero or missing', async () => {
      await start();
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 0 });
      expect(t.cart()[0].qty).toBe(1);
    });

    it('edit index replaces the line and keeps bundle metadata; invalid index ignored', async () => {
      await start();
      withCart([line(), line({ productId: 'cola', name: 'Cola', price: 50 })]);
      t.onAddonSelected({
        product: P_LATTE,
        addOns: [shotAddOn()],
        quantity: 4,
        specialInstructions: 'x',
        editIndex: 0,
      });
      expect(t.cart()[0]).toMatchObject({ qty: 4, specialInstructions: 'x', bundlePromotionId: null });
      expect(t.cart()[0].addOns).toEqual([shotAddOn()]);
      expect(t.cart()[1].productId).toBe('cola');

      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 9, editIndex: 7 });
      t.onAddonSelected({ product: P_LATTE, addOns: [], quantity: 9, editIndex: -1 });
      expect(t.cart().length).toBe(2);
    });
  });

  describe('quantity changes', () => {
    beforeEach(async () => {
      await start();
      withCart([line({ qty: 2 }), line({ productId: 'cola', name: 'Cola', price: 50 })]);
    });

    it('increments', () => {
      t.increment('latte', 0);
      expect(t.cart()[0].qty).toBe(3);
      t.increment('latte', 99);
      expect(t.cart().length).toBe(2);
    });

    it('decrements and removes at one', () => {
      t.decrement('latte', 0);
      expect(t.cart()[0].qty).toBe(1);
      t.decrement('cola', 1);
      expect(t.cart().map((c) => c.productId)).toEqual(['latte']);
      t.decrement('x', 5);
      expect(t.cart().length).toBe(1);
    });

    it('clearAll empties the cart', () => {
      t.clearAll();
      expect(t.cart()).toEqual([]);
    });

    it('item count and total sum lines', () => {
      expect(t.itemCount()).toBe(3);
      expect(t.totalPrice()).toBe(250);
    });

    it('mix and match increment/decrement opens the editor with adjusted quantity', async () => {
      withCart([
        line({
          productId: 'm1',
          name: 'Mix',
          price: 200,
          qty: 2,
          bundlePromotionId: 'm1',
          bundlePromotionTypeId: PromotionTypeEnum.MixMatch,
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 2 }],
        }),
      ]);
      t.increment('m1', 0);
      await settle();
      expect(promotionService['getMixMatchPromotion']).toHaveBeenCalledWith('m1');
      const opts = selectorOpen.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(opts['quantity']).toBe(3);
      expect(opts['editIndex']).toBe(0);
      expect(opts['requiredSelectionCount']).toBe(2);
      expect(t.cart()[0].qty).toBe(2);

      t.decrement('m1', 0);
      const opts2 = selectorOpen.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(opts2['quantity']).toBe(1);
    });

    it('fixed bundle increment/decrement simply changes qty', () => {
      withCart([
        line({
          productId: 'b1',
          name: 'Combo',
          price: 150,
          qty: 2,
          bundlePromotionId: 'b1',
          bundlePromotionTypeId: PromotionTypeEnum.FixedBundle,
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 1 }],
        }),
      ]);
      t.increment('b1', 0);
      expect(t.cart()[0].qty).toBe(3);
      t.decrement('b1', 0);
      expect(t.cart()[0].qty).toBe(2);
    });

    it('mix and match type inferred from bundle promotions when line lacks it', () => {
      t.bundlePromotions.set([bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch })]);
      withCart([
        line({
          productId: 'm1',
          qty: 1,
          bundlePromotionId: 'm1',
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 1 }],
        }),
      ]);
      t.increment('m1', 0);
      expect(promotionService['getMixMatchPromotion']).toHaveBeenCalled();
    });

    it('mix and match fetch failure alerts', () => {
      promotionService['getMixMatchPromotion'].mockReturnValue(throwError(() => new Error('')));
      withCart([
        line({
          productId: 'm1',
          qty: 1,
          bundlePromotionId: 'm1',
          bundlePromotionTypeId: PromotionTypeEnum.MixMatch,
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 1 }],
        }),
      ]);
      t.increment('m1', 0);
      expect(alert['error']).toHaveBeenCalledWith('load bundle promotion failed');
    });
  });

  describe('protecting a sale from changes made meanwhile', () => {
    const percent = (extra: object = {}) => [
      {
        id: 'd',
        name: 'D',
        isActive: true,
        startDate: null,
        endDate: null,
        items: [{ productId: 'latte', percentOff: 50, addOns: [] }],
        ...extra,
      },
    ];
    const askedServer = () => promotionService['getActiveDiscountedProductPromotions'];

    it('a cart without promotions opens checkout straight away, without asking the shop', async () => {
      await start();
      withCart([line({ productId: 'cola', name: 'Cola', price: 50 })]);
      const calls = askedServer().mock.calls.length;

      t.checkout();

      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      expect(askedServer().mock.calls.length).toBe(calls);
    });

    it('a cart with a promotion asks the shop again, and opens checkout when the total is the same', async () => {
      askedServer().mockReturnValue(of(percent()));
      await start();
      withCart([line({ qty: 2 })]);
      const calls = askedServer().mock.calls.length;

      t.checkout();

      expect(askedServer().mock.calls.length).toBe(calls + 1);
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      expect(alert['error']).not.toHaveBeenCalled();
    });

    it('stops with a message when the promotion ran out meanwhile, and shows the new total', async () => {
      askedServer().mockReturnValue(of(percent()));
      await start();
      withCart([line({ qty: 2 })]);
      expect(t.totalPrice()).toBe(100);
      askedServer().mockReturnValue(
        of(percent({ schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 5, redemptions: 5 } })),
      );

      t.checkout();

      expect(checkoutOpen).not.toHaveBeenCalled();
      expect(t.totalPrice()).toBe(200);
      expect(alert['error']).toHaveBeenCalledWith(
        'A promotion changed while you were ordering. The total is now PHP 200.00 (it was PHP 100.00). Please review the order.',
      );
    });

    it('a plain cart does not ask again, so a promotion that starts meanwhile is caught by the server total check instead', async () => {
      await start();
      withCart([line({ qty: 2 })]);
      askedServer().mockReturnValue(of(percent()));
      const calls = askedServer().mock.calls.length;

      t.checkout();

      expect(askedServer().mock.calls.length).toBe(calls);
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      t.onOrderConfirmed(cash);
      expect(orderService['createOrder'].mock.calls.at(-1)?.[0].expectedTotal).toBe(200);
    });

    it('goes on to checkout when the shop cannot be asked, because the server checks the total when the sale is saved', async () => {
      askedServer().mockReturnValue(of(percent()));
      await start();
      withCart([line()]);
      askedServer().mockReturnValue(throwError(() => new Error('down')));

      t.checkout();

      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('does not ask the shop while offline', async () => {
      askedServer().mockReturnValue(of(percent()));
      await start();
      withCart([line()]);
      isOnline.set(false);
      const calls = askedServer().mock.calls.length;

      t.checkout();

      expect(askedServer().mock.calls.length).toBe(calls);
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('a finished sale sends the total the cashier saw; an open order and an offline sale do not', async () => {
      askedServer().mockReturnValue(of(percent()));
      await start();
      withCart([line({ qty: 2 })]);

      t.onOrderConfirmed(cash);
      expect(orderService['createOrder'].mock.calls[0][0].expectedTotal).toBe(100);

      orderService['createOrder'].mockClear();
      t.onOrderSaved();
      expect(orderService['createOrder'].mock.calls[0][0]).not.toHaveProperty('expectedTotal');
    });

    it('an offline sale is never checked against the server total', async () => {
      await start();
      withCart([line()]);
      isOnline.set(false);

      t.onOrderConfirmed(cash);

      const queued = offline['queue'].mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(queued).not.toHaveProperty('expectedTotal');
    });

    it('when the server says the total changed, the message is shown and the promotions are loaded again', async () => {
      await start();
      withCart([line()]);
      orderService['createOrder'].mockReturnValue(
        throwError(() => new Error('The total changed to PHP 150.00 while you were checking out.')),
      );
      const calls = askedServer().mock.calls.length;

      t.onOrderConfirmed(cash);

      expect(alert['error']).toHaveBeenCalledWith(expect.stringContaining('The total changed to PHP 150.00'));
      expect(askedServer().mock.calls.length).toBe(calls + 1);
      expect(t.isSavingOrder()).toBe(false);
    });

    it('another save error does not reload the promotions', async () => {
      await start();
      withCart([line()]);
      orderService['createOrder'].mockReturnValue(throwError(() => new Error('boom')));
      const calls = askedServer().mock.calls.length;

      t.onOrderConfirmed(cash);

      expect(askedServer().mock.calls.length).toBe(calls);
    });

    describe('an open order that already holds uses of a limited promotion', () => {
      const limited = (maxRedemptions: number, redemptions: number) =>
        percent({ schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions, redemptions } });
      const held = (discountPromotionId: string | null) =>
        order({
          status: OrderStatusEnum.Pending,
          items: [
            { id: 'i1', productId: 'latte', productName: 'Latte', quantity: 2, price: null, addOns: [], discountPromotionId },
          ],
        });

      it('keeps its own uses when it holds every one, so its discount does not disappear while it is edited', async () => {
        askedServer().mockReturnValue(of(limited(2, 2)));
        await start();
        t.currentOrder.set(held('d'));

        expect(t.getDiscountedUnitPrice(line({ qty: 2 }))).toBe(50);
        // A third item has no use to take, so it pays the list price.
        expect(t.getLineDiscount(line({ qty: 3 }))).toEqual({ price: 50, quantity: 2 });
      });

      it('an order that does not hold a use cannot take one that is gone', async () => {
        askedServer().mockReturnValue(of(limited(2, 2)));
        await start();
        t.currentOrder.set(held(null));

        expect(t.getDiscountedUnitPrice(line({ qty: 1 }))).toBeNull();
      });

      it('uses held by other orders stay taken', async () => {
        askedServer().mockReturnValue(of(limited(5, 4)));
        await start();
        t.currentOrder.set(held('d'));

        expect(t.getDiscountedUnitPrice(line({ qty: 3 }))).toBe(50);
        expect(t.getLineDiscount(line({ qty: 4 }))).toEqual({ price: 50, quantity: 3 });
      });

      it('only an open order counts: a finished order has nothing held', async () => {
        askedServer().mockReturnValue(of(limited(2, 2)));
        await start();
        t.currentOrder.set({ ...held('d'), status: OrderStatusEnum.Completed });

        expect(t.getDiscountedUnitPrice(line({ qty: 1 }))).toBeNull();
      });
    });
  });

  describe('stock that blocks a sale', () => {
    const blockCups = (balance: number) => {
      limitItems.set([{ id: 'cup', name: 'Cup', unitName: 'pc', balance }]);
      limitLinks.set([{ productId: 'latte', itemId: 'cup', quantityPerSale: 1 }]);
    };
    const checkoutButton = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Checkout',
      ) as HTMLButtonElement;

    it('starts and stops asking the shop for the balances with the screen', async () => {
      await start();
      expect(stockLimits.start).toHaveBeenCalledTimes(1);

      fixture.destroy();

      expect(stockLimits.stop).toHaveBeenCalledTimes(1);
    });

    it('says nothing and does not block when no item blocks sales', async () => {
      await start();
      withCart([line({ qty: 5 })]);

      expect(t.stockMessages()).toEqual([]);
      expect(t.stockBlocksCheckout()).toBe(false);
    });

    it('labels the line and blocks checkout when a blocking item cannot cover the cart', async () => {
      blockCups(1);
      await start();
      withCart([line({ qty: 2 })]);
      fixture.detectChanges();

      expect(t.stockMessages().map((m) => m.text)).toEqual(['Cup: 1 pc left, needs 2 pc']);
      expect(t.stockNotesForLine(0)).toEqual(['Cup: 1 pc left, needs 2 pc']);
      expect(t.stockBlocksCheckout()).toBe(true);
      expect(checkoutButton().disabled).toBe(true);
      const banner = (fixture.nativeElement as HTMLElement).querySelector('[data-stock-banner]')?.textContent ?? '';
      expect(banner).toContain('Not enough stock to check out');
      expect(banner).toContain('1 item is short');
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-stock-note]')).not.toBeNull();
    });

    it('lets the sale through when the stock is exactly enough', async () => {
      blockCups(2);
      await start();
      withCart([line({ qty: 2 })]);
      fixture.detectChanges();

      expect(t.stockBlocksCheckout()).toBe(false);
      expect(checkoutButton().disabled).toBe(false);
    });

    it('does not label a line that does not use the short item', async () => {
      blockCups(1);
      await start();
      withCart([line({ qty: 2 }), line({ productId: 'cola', name: 'Cola', price: 50 })]);

      expect(t.stockNotesForLine(0)).toHaveLength(1);
      expect(t.stockNotesForLine(1)).toEqual([]);
    });

    it('lists every short item under a line, and counts them in the banner', async () => {
      limitItems.set([
        { id: 'cup', name: 'Cup', unitName: 'pc', balance: 1 },
        { id: 'lid', name: 'Lid', unitName: 'pc', balance: 0 },
      ]);
      limitLinks.set([
        { productId: 'latte', itemId: 'cup', quantityPerSale: 1 },
        { productId: 'latte', itemId: 'lid', quantityPerSale: 1 },
      ]);
      await start();
      withCart([line({ qty: 2 })]);
      fixture.detectChanges();

      expect(t.stockNotesForLine(0)).toEqual(['Cup: 1 pc left, needs 2 pc', 'Lid: 0 pc left, needs 2 pc']);
      const root = fixture.nativeElement as HTMLElement;
      // The cart is drawn in the drawer and in the side panel, so each note shows once in each.
      const shown = new Set([...root.querySelectorAll('[data-stock-note]')].map((note) => note.textContent?.trim()));
      expect([...shown]).toEqual(['Cup: 1 pc left, needs 2 pc', 'Lid: 0 pc left, needs 2 pc']);
      expect(root.querySelector('[data-stock-banner]')?.textContent).toContain('2 items are short');
    });

    it('asks for the latest balances at checkout and stops when the cart is still short', async () => {
      blockCups(5);
      await start();
      withCart([line({ qty: 3 })]);
      stockLimits.load.mockImplementation(() => {
        blockCups(1);
        return of({ items: limitItems(), links: limitLinks(), asOf: '' });
      });

      t.checkout();

      expect(stockLimits.load).toHaveBeenCalledTimes(1);
      expect(checkoutOpen).not.toHaveBeenCalled();
      expect(alert['error']).toHaveBeenCalledWith(
        'Not enough stock to check out. Cup: 1 pc left, needs 3 pc.',
      );
    });

    it('opens checkout when the latest balances cover the cart', async () => {
      blockCups(2);
      await start();
      withCart([line({ qty: 3 })]);
      stockLimits.load.mockImplementation(() => {
        blockCups(10);
        return of({ items: limitItems(), links: limitLinks(), asOf: '' });
      });

      t.checkout();

      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('goes on to checkout when the balances cannot be loaded, and the server decides', async () => {
      blockCups(10);
      await start();
      withCart([line({ qty: 2 })]);
      stockLimits.load.mockReturnValue(throwError(() => new Error('down')));

      t.checkout();

      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('only warns while offline, because the sale is honored when it syncs', async () => {
      blockCups(1);
      await start();
      withCart([line({ qty: 2 })]);
      isOnline.set(false);
      fixture.detectChanges();

      expect(t.stockMessages()).toHaveLength(1);
      expect(t.stockBlocksCheckout()).toBe(false);
      expect(checkoutButton().disabled).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-stock-banner]')?.textContent).toContain(
        'you are offline',
      );

      t.checkout();

      expect(stockLimits.load).not.toHaveBeenCalled();
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('never blocks saving an open order', async () => {
      blockCups(1);
      await start();
      withCart([line({ qty: 2 })]);
      fixture.detectChanges();

      const save = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Save',
      ) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
    });

    it('does not judge an Admin override, which the server works out on the net change', async () => {
      blockCups(1);
      await start();
      withCart([line({ qty: 2 })]);
      t.isOverrideMode.set(true);

      expect(t.stockMessages()).toEqual([]);
      expect(t.stockBlocksCheckout()).toBe(false);
    });
  });

  describe('promotions and totals', () => {
    const promos = (items: object[], extra: object = {}): DiscountedProductPromotionDto[] => [
      {
        id: 'd',
        name: 'D',
        isActive: true,
        startDate: null,
        endDate: null,
        items: items as DiscountedProductPromotionDto['items'],
        ...extra,
      },
    ];

    it('plain line totals include add-ons', async () => {
      await start();
      const l = line({ qty: 2, addOns: [shotAddOn(), shotAddOn()] });
      expect(t.getUnitSubtotal(l)).toBe(140);
      expect(t.getLineTotal(l)).toBe(280);
      expect(t.getDiscountedUnitPrice(l)).toBeNull();
      expect(t.getDiscountedAmount(l)).toBe(0);
      expect(t.getDiscountedPromoLabel(l)).toBeNull();
    });

    it('an amount off above the price labels the price taken off while an add-on is charged, and Free when nothing is', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promos([{ productId: 'latte', fixedPrice: 500, addOns: [{ addOnProductId: 'shot', quantity: 1 }] }])),
      );
      await start();
      const charged = line({ addOns: [shotAddOn()] });

      expect(t.getDiscountedUnitPrice(charged)).toBe(0);
      expect(t.getDiscountedPromoLabel(charged)).toBe('Promo -₱100.00');

      const free = line({ addOns: [{ ...shotAddOn(), price: 0 }] });
      expect(t.getDiscountedPromoLabel(free)).toBe('Free');
    });

    it('bundle line total is qty * bundle price, ignoring child prices', async () => {
      await start();
      const l = line({
        price: 150,
        qty: 2,
        bundlePromotionId: 'b1',
        bundleItems: [{ productId: 'latte', name: 'L', price: 100, qty: 3 }],
      });
      expect(t.getLineTotal(l)).toBe(300);
      expect(t.getDiscountedUnitPrice(l)).toBeNull();
      expect(t.getDiscountedAmount(l)).toBe(0);
    });

    it('applies fixed-price discount (amount off) to the base price only', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promos([{ productId: 'latte', fixedPrice: 30, addOns: [{ addOnProductId: 'shot', quantity: 1 }] }])),
      );
      await start();
      const l = line({ qty: 2, addOns: [shotAddOn()] });
      expect(t.getDiscountedUnitPrice(l)).toBe(70);
      expect(t.getUnitSubtotal(l)).toBe(90);
      expect(t.getLineTotal(l)).toBe(180);
      expect(t.getDiscountedAmount(l)).toBe(60);
      expect(t.getDiscountedPromoLabel(l)).toContain('30.00');
      const breakdown = t.getBreakdown(l);
      expect(breakdown.rows.map((r) => [r.kind, r.amount])).toEqual([
        ['base', 200],
        ['addOn', 40],
        ['discount', -60],
      ]);
      expect(breakdown.total).toBe(t.getLineTotal(l));

      // Required add-ons must match exactly (no extra, none missing).
      expect(t.getDiscountedUnitPrice(line())).toBeNull();
      expect(t.getDiscountedUnitPrice(line({ addOns: [shotAddOn(), shotAddOn()] }))).toBeNull();
      expect(
        t.getDiscountedUnitPrice(
          line({ addOns: [shotAddOn(), { addOnId: 'other', name: 'o', price: 1 }] }),
        ),
      ).toBeNull();
    });

    it('applies percent discount rounded to cents and picks the best of several', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([
            { productId: 'latte', percentOff: 10, addOns: [{ addOnProductId: 'shot', quantity: 1 }] },
            { productId: 'latte', percentOff: 33.333, addOns: [{ addOnProductId: 'shot', quantity: 1 }] },
            { productId: 'latte', addOns: [{ addOnProductId: 'shot', quantity: 1 }] },
          ]),
        ),
      );
      await start();
      const l = line({ addOns: [shotAddOn()] });
      expect(t.getDiscountedUnitPrice(l)).toBe(66.67);
      expect(t.getDiscountedPromoLabel(l)).toBe('Promo -33.33%');
    });

    it('a rule with no add-ons is for the plain product only', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promos([{ productId: 'latte', percentOff: 20, addOns: [] }])),
      );
      await start();

      expect(t.getDiscountedUnitPrice(line())).toBe(80);
      expect(t.getDiscountedUnitPrice(line({ addOns: [shotAddOn()] }))).toBeNull();
    });

    it('a promotion with a usage limit only discounts the items it has uses left for', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([{ productId: 'latte', percentOff: 20, addOns: [] }], {
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 3, redemptions: 1 },
          }),
        ),
      );
      await start();

      expect(t.getDiscountedUnitPrice(line({ qty: 2 }))).toBe(80);
      // Two uses are left for three items: two get the price, the third pays the list price.
      expect(t.getLineDiscount(line({ qty: 3 }))).toEqual({ price: 80, quantity: 2 });
      expect(t.getLineTotal(line({ qty: 3 }))).toBe(2 * 80 + 100);
      expect(t.getPartialDiscountNote(line({ qty: 3 }))).toBe('Promo on 2 (only 2 left); the other 1 at full price.');
      expect(t.getPartialDiscountNote(line({ qty: 2 }))).toBeNull();
    });

    it('a limit per order covers only that many items and says so', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([{ productId: 'latte', percentOff: 50, addOns: [] }], {
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, maxPerOrder: 2, redemptions: 0 },
          }),
        ),
      );
      await start();
      const only = line({ qty: 5 });
      withCart([only]);

      expect(t.getLineDiscount(only)).toEqual({ price: 50, quantity: 2 });
      expect(t.getLineTotal(only)).toBe(2 * 50 + 3 * 100);
      expect(t.totalPrice()).toBe(2 * 50 + 3 * 100);
      expect(t.getDiscountedAmount(only)).toBe(100);
      expect(t.getPartialDiscountNote(only)).toBe('Promo on 2 (limit of 2 per order); the other 3 at full price.');
      const items = t.checkoutCartItems();
      expect(items.map((i: { qty: number; price: number }) => [i.qty, i.price])).toEqual([
        [2, 50],
        [3, 100],
      ]);
    });

    it('the lines of one order share what a promotion can discount', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([{ productId: 'latte', percentOff: 50, addOns: [] }], {
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, maxPerOrder: 3, redemptions: 0 },
          }),
        ),
      );
      await start();
      const a = line({ qty: 2, specialInstructions: 'a' });
      const b = line({ qty: 2, specialInstructions: 'b' });
      withCart([a, b]);

      expect(t.getLineDiscount(a)).toEqual({ price: 50, quantity: 2 });
      expect(t.getLineDiscount(b)).toEqual({ price: 50, quantity: 1 });
      expect(t.totalPrice()).toBe(3 * 50 + 100);
    });

    it('an offline sale sends a part-covered line as two lines with their own quotes', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([{ productId: 'latte', percentOff: 50, addOns: [] }], {
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: null, maxPerOrder: 2, redemptions: 0 },
          }),
        ),
      );
      await start();
      withCart([line({ qty: 3 })]);

      const items = t.buildOrderItemsFromCart(true);

      expect(items.map((i) => [i['quantity'], i['quotedPrice'], i['quotedPromoLabel']])).toEqual([
        [2, 50, 'Promo -50%'],
        [1, 100, null],
      ]);
      expect(t.buildOrderItemsFromCart(false)).toHaveLength(1);
    });

    it('a promotion with no uses left discounts nothing', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(
          promos([{ productId: 'latte', percentOff: 20, addOns: [] }], {
            schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 5, redemptions: 5 },
          }),
        ),
      );
      await start();

      expect(t.getDiscountedUnitPrice(line())).toBeNull();
    });

    it('a promotion is only on during its weekdays and hours', async () => {
      const today = new Date().getDay();
      const otherDay = 1 << ((today + 1) % 7);
      const thisDay = 1 << today;
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of([
          ...promos([{ productId: 'latte', percentOff: 50, addOns: [] }], {
            id: 'other-day',
            schedule: { daysOfWeek: otherDay, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 },
          }),
          ...promos([{ productId: 'latte', percentOff: 10, addOns: [] }], {
            id: 'today',
            schedule: { daysOfWeek: thisDay, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 },
          }),
        ]),
      );
      await start();

      expect(t.getDiscountedUnitPrice(line())).toBe(90);
    });

    it('checkoutCartItems carries promo label/discount and discounted price', async () => {
      promotionService['getActiveDiscountedProductPromotions'].mockReturnValue(
        of(promos([{ productId: 'latte', percentOff: 20, addOns: [{ addOnProductId: 'shot', quantity: 1 }] }])),
      );
      await start();
      withCart([line({ qty: 3, addOns: [shotAddOn()] }), line({ productId: 'cola', name: 'Cola', price: 50 })]);
      const items = t.checkoutCartItems();
      expect(items[0].price).toBe(80);
      expect(items[0].promoDiscount).toBe(60);
      expect(items[0].promoLabel).toBe('Promo -20%');
      expect(items[1].promoDiscount).toBeNull();
      expect(items[1].price).toBe(50);
    });

    it('bundle child quantity helper', async () => {
      await start();
      const child = { productId: 'c', name: 'c', price: 0, qty: 2 };
      expect(t.getBundleChildTotalQuantity(line({ qty: 3 }), child)).toBe(6);
      expect(
        t.getBundleChildTotalQuantity(
          line({ qty: 3, bundlePromotionTypeId: PromotionTypeEnum.MixMatch }),
          child,
        ),
      ).toBe(2);
    });

    it('sorts bundle items and builds the breakdown rows', async () => {
      await start();
      const l = line({
        qty: 2,
        bundleItems: [
          { productId: 'a', name: '2x Zed', price: 0, qty: 1 },
          { productId: 'b', name: 'Alpha', price: 0, qty: 1 },
        ],
        addOns: [shotAddOn(), shotAddOn(), { addOnId: 'n', name: 'Misc', price: -5 }],
      });
      expect(t.getSortedBundleItems(l).map((b) => b.name)).toEqual(['Alpha', '2x Zed']);
      const { rows, total } = t.getBreakdown(l);
      expect(rows.map((r) => [r.kind, r.amount])).toEqual([
        ['base', 200],
        ['addOn', 80],
        ['addOn', -10],
      ]);
      expect(rows[1].detail).toBe('₱20.00 × 4 (2 per item)');
      expect(total).toBe(270);
    });

    it('rejects saving when a unit price turns negative', async () => {
      await start();
      withCart([line({ name: 'Latte', price: 10, addOns: [{ addOnId: 'x', name: 'X', price: -50 }] })]);
      t.onOrderSaved();
      expect(alert['error']).toHaveBeenCalledWith('Latte cannot have a negative final unit price.');
      expect(orderService['createOrder']).not.toHaveBeenCalled();

      t.checkout();
      expect(checkoutOpen).not.toHaveBeenCalled();
    });

    it('rejects negative bundle price', async () => {
      await start();
      withCart([
        line({
          name: 'B',
          price: -1,
          bundlePromotionId: 'b1',
          bundleItems: [{ productId: 'latte', name: 'L', price: 1, qty: 1 }],
        }),
      ]);
      t.onOrderSaved();
      expect(alert['error']).toHaveBeenCalled();
    });
  });

  describe('bundles', () => {
    beforeEach(async () => {
      await start();
    });

    it('rejects inactive-window promotions', () => {
      t.addBundlePromotionToCart(bundlePromo({ endDate: '2000-01-01T00:00:00Z' }));
      expect(alert['error']).toHaveBeenCalledWith(
        'This bundle promotion is not available right now.',
      );
      expect(promotionService['getFixedBundle']).not.toHaveBeenCalled();
    });

    it('opens a bundle from the saved catalog without asking the server', () => {
      catalog.getFixedBundle.mockReturnValue(fixedBundleDto());

      t.addBundlePromotionToCart(bundlePromo());

      expect(promotionService['getFixedBundle']).not.toHaveBeenCalled();
      expect(selectorOpen).toHaveBeenCalled();
    });

    it('opens a mix and match from the saved catalog without asking the server', () => {
      catalog.getMixMatch.mockReturnValue(mixMatchDto());

      t.addBundlePromotionToCart(bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch }));

      expect(promotionService['getMixMatchPromotion']).not.toHaveBeenCalled();
      expect(selectorOpen).toHaveBeenCalled();
    });

    it('does not open a bundle that is closed today or at this hour', () => {
      const closedDay = 1 << ((new Date().getDay() + 1) % 7);

      t.addBundlePromotionToCart(
        bundlePromo({ schedule: { daysOfWeek: closedDay, startTime: null, endTime: null, maxRedemptions: null, redemptions: 0 } }),
      );

      expect(alert['error']).toHaveBeenCalledWith('This bundle promotion is not available right now.');
      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('does not open a bundle with no uses left', () => {
      t.addBundlePromotionToCart(
        bundlePromo({ schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 2, redemptions: 2 } }),
      );

      expect(alert['error']).toHaveBeenCalledWith('This bundle promotion has no uses left.');
      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('hides a bundle with no uses left from the Bundles tab', () => {
      catalog.bundlePromotions.set([
        bundlePromo({ id: 'open', name: 'Open' }),
        bundlePromo({
          id: 'spent',
          name: 'Spent',
          schedule: { daysOfWeek: null, startTime: null, endTime: null, maxRedemptions: 1, redemptions: 1 },
        }),
      ]);
      TestBed.tick();

      expect(t.filteredBundlePromotions().map((p) => p.id)).toEqual(['open']);
    });

    it('fixed bundle opens selector and then adds a bundle line', () => {
      t.addBundlePromotionToCart(bundlePromo());
      expect(promotionService['getFixedBundle']).toHaveBeenCalledWith('b1');
      expect(selectorOpen).toHaveBeenCalled();
      const [prod, opts] = selectorOpen.mock.calls.at(-1) as [ProductDto, Record<string, unknown>];
      expect(prod).toMatchObject({ id: 'b1', price: 150 });
      expect(opts['requiredSelectionCount']).toBeNull();
      expect(opts['subtitleText']).toBe('Customize your order');

      t.onAddonSelected({ product: prod, addOns: [], quantity: 2, specialInstructions: 'rush' });
      const l = t.cart()[0];
      expect(l).toMatchObject({
        productId: 'b1',
        price: 150,
        qty: 2,
        bundlePromotionId: 'b1',
        bundlePromotionTypeId: PromotionTypeEnum.FixedBundle,
        specialInstructions: 'rush',
      });
      expect(l.bundleItems?.map((b) => [b.productId, b.qty])).toEqual([
        ['chips', 2],
        ['latte', 1],
      ]);
      const latte = l.bundleItems?.find((b) => b.productId === 'latte');
      expect(latte?.addOns?.length).toBe(2);
      expect(latte?.addOns?.[0]).toMatchObject({ addOnId: 'shot', price: 20 });
      expect(t.getLineTotal(l)).toBe(300);
    });

    it('adding the same fixed bundle again merges quantity', () => {
      t.addBundlePromotionToCart(bundlePromo());
      const prod = (selectorOpen.mock.calls.at(-1) as [ProductDto])[0];
      t.onAddonSelected({ product: prod, addOns: [], quantity: 1 });
      t.addBundlePromotionToCart(bundlePromo());
      t.onAddonSelected({ product: prod, addOns: [], quantity: 2, specialInstructions: 'later' });
      expect(t.cart().length).toBe(1);
      expect(t.cart()[0].qty).toBe(3);
      expect(t.cart()[0].specialInstructions).toBe('later');
    });

    it('errors when bundle products are not in the catalog', () => {
      promotionService['getFixedBundle'].mockReturnValue(
        of({ ...fixedBundleDto(), items: [{ productId: 'ghost', quantity: 1, addOns: [] }] }),
      );
      t.addBundlePromotionToCart(bundlePromo());
      expect(alert['error']).toHaveBeenCalledWith(
        'Bundle products are unavailable in the current catalog.',
      );
      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('bundle fetch failure alerts with fallback message', () => {
      promotionService['getFixedBundle'].mockReturnValue(throwError(() => new Error('')));
      t.addBundlePromotionToCart(bundlePromo());
      expect(alert['error']).toHaveBeenCalledWith('load bundle promotion failed');
    });

    it('mix and match builds custom groups and normalizes selection by add-on counts', () => {
      t.addBundlePromotionToCart(bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch }));
      expect(promotionService['getMixMatchPromotion']).toHaveBeenCalledWith('m1');
      const [prod, opts] = selectorOpen.mock.calls.at(-1) as [ProductDto, Record<string, unknown>];
      expect(opts['requiredSelectionCount']).toBe(2);
      expect(opts['maxSelectionPerOption']).toBe(3);
      expect(opts['scaleRequiredSelectionByQuantity']).toBe(true);
      const groups = opts['customGroups'] as AddOnGroupDto[];
      expect(groups[0].options.map((o) => [o.id, o.price])).toEqual([
        ['cola', 0],
        ['latte', 0],
      ]);

      const pick = (id: string): CartAddOnDto => ({ addOnId: id, name: id, price: 0 });
      t.onAddonSelected({ product: prod, addOns: [pick('latte'), pick('latte'), pick('cola')], quantity: 1 });
      const l = t.cart()[0];
      expect(l.bundlePromotionTypeId).toBe(PromotionTypeEnum.MixMatch);
      expect(l.bundleRequiredSelectionCount).toBe(2);
      expect(l.bundleMaxSelectionPerOption).toBe(3);
      expect(l.bundleItems?.map((b) => [b.productId, b.qty])).toEqual([
        ['cola', 1],
        ['latte', 2],
      ]);
    });

    it('mix and match merges child quantities when added again', () => {
      t.addBundlePromotionToCart(bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch }));
      const prod = (selectorOpen.mock.calls.at(-1) as [ProductDto])[0];
      const pick = (id: string): CartAddOnDto => ({ addOnId: id, name: id, price: 0 });
      t.onAddonSelected({ product: prod, addOns: [pick('latte'), pick('cola')], quantity: 1 });
      t.addBundlePromotionToCart(bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch }));
      t.onAddonSelected({ product: prod, addOns: [pick('latte'), pick('latte')], quantity: 1 });
      expect(t.cart().length).toBe(1);
      expect(t.cart()[0].qty).toBe(2);
      expect(t.cart()[0].bundleItems?.map((b) => [b.productId, b.qty])).toEqual([
        ['cola', 1],
        ['latte', 3],
      ]);
    });

    it('editing a bundle line replaces it at index', () => {
      t.addBundlePromotionToCart(bundlePromo());
      const prod = (selectorOpen.mock.calls.at(-1) as [ProductDto])[0];
      withCart([line(), line({ productId: 'cola', name: 'Cola' })]);
      t.addBundlePromotionToCart(bundlePromo());
      t.onAddonSelected({ product: prod, addOns: [], quantity: 2, editIndex: 1 });
      expect(t.cart()[1].bundlePromotionId).toBe('b1');
      expect(t.cart()[1].qty).toBe(2);
      t.addBundlePromotionToCart(bundlePromo());
      t.onAddonSelected({ product: prod, addOns: [], quantity: 2, editIndex: 9 });
      expect(t.cart().length).toBe(2);
    });
  });

  describe('bundles without write permission', () => {
    it('does not fetch the bundle', async () => {
      canWrite = false;
      await start();
      t.addBundlePromotionToCart(bundlePromo());
      expect(promotionService['getFixedBundle']).not.toHaveBeenCalled();
    });
  });

  describe('editing cart lines', () => {
    beforeEach(async () => {
      await start();
    });

    it('opens the add-on selector for a regular line', () => {
      withCart([line({ qty: 2, addOns: [shotAddOn()], specialInstructions: 'hot' })]);
      t.editCartItem(0);
      expect(selectorOpen).toHaveBeenCalledWith(
        P_LATTE,
        expect.objectContaining({
          quantity: 2,
          addOns: [shotAddOn()],
          specialInstructions: 'hot',
          editIndex: 0,
        }),
      );
    });

    it('shows the products when the catalog fills in after the page opened', async () => {
      // A fresh device: nothing cached, and the first sync only finishes once the connection check does.
      catalog.products.set([]);
      await start();
      expect(t.products().length).toBe(0);

      catalog.products.set(ALL_PRODUCTS);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();

      expect(t.products().length).toBe(5);
      expect(t.productsBySubCategory()[ProductSubCategoryEnum.Coffee].map((p) => p.id)).toEqual(['latte', 'mocha']);
    });

    it('falls back to a synthesized product when not in any cache', () => {
      catalog.products.set([]);
      t.productsCache.set([]);
      withCart([line({ productId: 'gone', name: 'Gone', price: 9 })]);
      t.editCartItem(0);
      const prod = selectorOpen.mock.calls.at(-1)?.[0] as ProductDto;
      expect(prod).toMatchObject({ id: 'gone', name: 'Gone', price: 9, category: ProductCategoryEnum.Other });
    });

    it('ignores invalid index and read-only orders', () => {
      t.editCartItem(3);
      expect(selectorOpen).not.toHaveBeenCalled();
      t.currentOrder.set(order({ status: OrderStatusEnum.Cancelled }));
      withCart([line()]);
      t.editCartItem(0);
      expect(selectorOpen).not.toHaveBeenCalled();
    });

    it('edits fixed bundles from the line data', () => {
      withCart([
        line({
          productId: 'b1',
          name: 'Combo',
          price: 150,
          qty: 2,
          bundlePromotionId: 'b1',
          bundlePromotionName: 'Combo',
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 1, addOns: [shotAddOn()] }],
        }),
      ]);
      t.editCartItem(0);
      expect(promotionService['getMixMatchPromotion']).not.toHaveBeenCalled();
      const [prod, opts] = selectorOpen.mock.calls.at(-1) as [ProductDto, Record<string, unknown>];
      expect(prod.id).toBe('b1');
      expect(opts['quantity']).toBe(2);
      expect(opts['editIndex']).toBe(0);
    });

    it('edits mix and match bundles via fetched promotion with preselected items', () => {
      t.bundlePromotions.set([bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch })]);
      withCart([
        line({
          productId: 'm1',
          name: 'Mix',
          price: 200,
          qty: 1,
          specialInstructions: 'x',
          bundlePromotionId: 'm1',
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 2 }],
        }),
      ]);
      t.editCartItem(0);
      const opts = selectorOpen.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      const pre = opts['addOns'] as CartAddOnDto[];
      expect(pre.map((a) => a.addOnId)).toEqual(['latte', 'latte']);
      expect(opts['specialInstructions']).toBe('x');
    });

    it('mix and match edit fetch failure alerts', () => {
      promotionService['getMixMatchPromotion'].mockReturnValue(throwError(() => new Error('bad')));
      t.bundlePromotions.set([bundlePromo({ id: 'm1', typeId: PromotionTypeEnum.MixMatch })]);
      withCart([
        line({
          productId: 'm1',
          bundlePromotionId: 'm1',
          bundleItems: [{ productId: 'latte', name: 'Latte', price: 100, qty: 1 }],
        }),
      ]);
      t.editCartItem(0);
      expect(alert['error']).toHaveBeenCalledWith('bad');
    });
  });

  describe('customer selection', () => {
    it('shows walk-in, known and unknown customers', async () => {
      await start();
      expect(t.selectedCustomerName()).toBe('Walk-in customer');
      t.onCustomerSelected('c1');
      expect(t.selectedCustomerName()).toBe('Jane Doe');
      t.onCustomerSelected('nope');
      expect(t.selectedCustomerName()).toBe('Unknown customer');
      t.onCustomerSelected(null);
      expect(t.selectedCustomerId()).toBeNull();
      expect(t.customerOptions()).toEqual([{ id: 'c1', label: 'Jane Doe' }]);
      expect(t.getCustomerDisplayName({ ...customerJane, lastName: '' })).toBe('Jane');
    });

    it('selection ignored without permission or while busy', async () => {
      await start();
      t.isSavingOrder.set(true);
      t.onCustomerSelected('c1');
      expect(t.selectedCustomerId()).toBeNull();
    });

    it('selection ignored without write permission', async () => {
      canWrite = false;
      await start();
      t.onCustomerSelected('c1');
      expect(t.selectedCustomerId()).toBeNull();
    });

    it('create customer modal is refused without permission', async () => {
      canCreateCustomer = false;
      await start();
      t.openCreateCustomerModal();
      expect(alert['errorUnauthorized']).toHaveBeenCalled();
      expect(t.showCreateCustomerModal()).toBe(false);
      t.saveCustomerFromModal();
      expect(customerService['createCustomer']).not.toHaveBeenCalled();
    });

    it('create customer modal: open/close and validation', async () => {
      await start();
      t.openCreateCustomerModal();
      expect(t.showCreateCustomerModal()).toBe(true);
      expect(modalStack.hasOpen()).toBe(true);
      t.saveCustomerFromModal();
      expect(customerService['createCustomer']).not.toHaveBeenCalled();
      t.closeCreateCustomerModal();
      expect(t.showCreateCustomerModal()).toBe(false);
      expect(modalStack.hasOpen()).toBe(false);
    });

    it('creates a customer and selects it', async () => {
      await start();
      t.openCreateCustomerModal();
      t.createCustomerForm.patchValue({ firstName: '  New ', lastName: ' Guy ' });
      t.saveCustomerFromModal();
      expect(customerService['createCustomer']).toHaveBeenCalledWith({ firstName: 'New', lastName: 'Guy' });
      expect(t.selectedCustomerId()).toBe('c2');
      expect(t.customers().length).toBe(2);
      expect(t.showCreateCustomerModal()).toBe(false);
      expect(alert['successCreated']).toHaveBeenCalledWith('Customer');
      expect(t.isCreatingCustomer()).toBe(false);
    });

    it('reports create customer failure', async () => {
      customerService['createCustomer'].mockReturnValue(throwError(() => new Error('')));
      await start();
      t.openCreateCustomerModal();
      t.createCustomerForm.patchValue({ firstName: 'A', lastName: 'B' });
      t.saveCustomerFromModal();
      expect(alert['error']).toHaveBeenCalledWith('create customer failed');
      expect(t.isCreatingCustomer()).toBe(false);
      expect(t.showCreateCustomerModal()).toBe(true);
    });
  });

  describe('special instructions', () => {
    it('updates from textarea input only with permission', async () => {
      await start();
      const ta = document.createElement('textarea');
      ta.value = 'no ice';
      const ev = new Event('input');
      Object.defineProperty(ev, 'target', { value: ta });
      t.onOrderSpecialInstructionsInput(ev);
      expect(t.orderSpecialInstructions()).toBe('no ice');

      t.onOrderSpecialInstructionsInput(new Event('input'));
      expect(t.orderSpecialInstructions()).toBe('');
    });

    it('ignores instruction input without write permission', async () => {
      canWrite = false;
      await start();
      const ta = document.createElement('textarea');
      ta.value = 'x';
      const ev = new Event('input');
      Object.defineProperty(ev, 'target', { value: ta });
      t.onOrderSpecialInstructionsInput(ev);
      expect(t.orderSpecialInstructions()).toBe('');
    });

    it('editing permissions in new mode', async () => {
      await start();
      expect(t.canEditOrderSpecialInstructions()).toBe(true);
      expect(t.canEditCustomerSelection()).toBe(true);
      canWrite = false;
      const f2 = TestBed.createComponent(OrderEditor);
      const t2 = f2.componentInstance as unknown as Editor;
      expect(t2.canEditOrderSpecialInstructions()).toBe(false);
    });
  });

  describe('creating orders', () => {
    beforeEach(async () => {
      await start();
      withCart([
        line({ qty: 2, addOns: [shotAddOn(), shotAddOn()], specialInstructions: 'hot' }),
        line({
          productId: 'b1',
          name: 'Combo',
          price: 150,
          qty: 2,
          bundlePromotionId: 'b1',
          bundlePromotionTypeId: PromotionTypeEnum.FixedBundle,
          specialInstructions: 'cut',
          bundleItems: [
            { productId: 'chips', name: 'Chips', price: 30, qty: 2 },
            { productId: 'latte', name: 'Latte', price: 100, qty: 1, addOns: [shotAddOn()] },
          ],
        }),
        line({
          productId: 'm1',
          name: 'Mix',
          price: 200,
          qty: 3,
          bundlePromotionId: 'm1',
          bundlePromotionTypeId: PromotionTypeEnum.MixMatch,
          bundleItems: [{ productId: 'cola', name: 'Cola', price: 50, qty: 4 }],
        }),
      ]);
      t.onCustomerSelected('c1');
      t.orderSpecialInstructions.set('  fast  ');
    });

    it('saves a pending order online with expanded bundle items', () => {
      t.onOrderSaved();
      expect(orderService['createOrder']).toHaveBeenCalledTimes(1);
      const cmd = orderService['createOrder'].mock.calls[0][0];
      expect(cmd).toEqual({
        customerId: 'c1',
        specialInstructions: 'fast',
        status: OrderStatusEnum.Pending,
        items: [
          {
            productId: 'latte',
            quantity: 2,
            addOns: [{ productId: 'shot', quantity: 2, addOns: [], bundlePromotionId: null }],
            specialInstructions: 'hot',
            bundlePromotionId: null,
          },
          {
            productId: 'chips',
            quantity: 4,
            addOns: [],
            specialInstructions: 'cut',
            bundlePromotionId: 'b1',
          },
          {
            productId: 'latte',
            quantity: 2,
            addOns: [{ productId: 'shot', quantity: 1, addOns: [], bundlePromotionId: null }],
            specialInstructions: 'cut',
            bundlePromotionId: 'b1',
          },
          { productId: 'cola', quantity: 4, addOns: [], specialInstructions: null, bundlePromotionId: 'm1' },
        ],
        bundlePromotions: [
          { promotionId: 'b1', quantity: 2 },
          { promotionId: 'm1', quantity: 3 },
        ],
      });
      expect(t.isSavingOrder()).toBe(false);
      expect(persistence['clear']).toHaveBeenCalled();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('checkout payment completes the order with payment details', () => {
      t.onOrderConfirmed(cash);
      const cmd = orderService['createOrder'].mock.calls[0][0];
      expect(cmd).toMatchObject({
        status: OrderStatusEnum.Completed,
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 500,
        changeAmount: 300,
        tips: 10,
      });
    });

    it('GCash payment sends nulls for cash-only fields', () => {
      t.onOrderConfirmed({ paymentMethod: PaymentMethodEnum.GCash });
      const cmd = orderService['createOrder'].mock.calls[0][0];
      expect(cmd).toMatchObject({
        paymentMethod: PaymentMethodEnum.GCash,
        amountReceived: null,
        changeAmount: null,
        tips: null,
      });
    });

    it('reports create failure and re-enables saving', () => {
      orderService['createOrder'].mockReturnValue(throwError(() => new Error('')));
      t.onOrderSaved();
      expect(alert['error']).toHaveBeenCalledWith('create order failed');
      expect(t.isSavingOrder()).toBe(false);
      expect(nav).not.toHaveBeenCalled();
      orderService['createOrder'].mockReturnValue(throwError(() => new Error('server down')));
      t.onOrderSaved();
      expect(alert['error']).toHaveBeenLastCalledWith('server down');
    });

    it('queues the order offline when disconnected', async () => {
      isOnline.set(false);
      t.onOrderSaved();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
      expect(offline['queue']).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatusEnum.Pending, customerId: 'c1' }),
        t.cart(),
        'Jane Doe',
        expect.any(Number),
      );
      await settle();
      expect(alert['info']).toHaveBeenCalledWith(
        "Order OFF-1 saved offline. It will sync when you're back online.",
      );
      expect(persistence['clear']).toHaveBeenCalled();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
      expect(t.isSavingOrder()).toBe(false);
    });

    it('quotes every price when it queues the order offline, so the server can tell what changed', async () => {
      isOnline.set(false);
      t.onOrderSaved();

      const queued = offline['queue'].mock.calls[0][0];
      expect(queued.items).toEqual([
        {
          productId: 'latte',
          quantity: 2,
          addOns: [{ productId: 'shot', quantity: 2, addOns: [], bundlePromotionId: null, quotedPrice: 20 }],
          specialInstructions: 'hot',
          bundlePromotionId: null,
          quotedPrice: 100,
          quotedOriginalPrice: 100,
          quotedPromoLabel: null,
        },
        {
          productId: 'chips',
          quantity: 4,
          addOns: [],
          specialInstructions: 'cut',
          bundlePromotionId: 'b1',
          quotedPrice: 30,
        },
        {
          productId: 'latte',
          quantity: 2,
          addOns: [{ productId: 'shot', quantity: 1, addOns: [], bundlePromotionId: null, quotedPrice: 20 }],
          specialInstructions: 'cut',
          bundlePromotionId: 'b1',
          quotedPrice: 100,
        },
        { productId: 'cola', quantity: 4, addOns: [], specialInstructions: null, bundlePromotionId: 'm1', quotedPrice: 50 },
      ]);
      expect(queued.bundlePromotions).toEqual([
        { promotionId: 'b1', quantity: 2, quotedUnitPrice: 150 },
        { promotionId: 'm1', quantity: 3, quotedUnitPrice: 200 },
      ]);
      await settle();
    });

    it('sends no quoted prices when the order goes straight to the server', () => {
      t.onOrderSaved();

      const cmd = orderService['createOrder'].mock.calls[0][0];
      expect(JSON.stringify(cmd)).not.toContain('quoted');
    });

    it('offline queue failure alerts and unlocks', async () => {
      isOnline.set(false);
      offline['queue'].mockRejectedValue(new Error('idb'));
      t.onOrderSaved();
      await settle();
      expect(alert['error']).toHaveBeenCalledWith('Failed to save order offline.');
      expect(t.isSavingOrder()).toBe(false);
    });

    it('does nothing for an empty cart or while saving', () => {
      t.isSavingOrder.set(true);
      t.onOrderSaved();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
      t.isSavingOrder.set(false);
      t.clearAll();
      t.onOrderSaved();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
    });

    it('unauthorized users get an error', async () => {
      canWrite = false;
      await start();
      withCart([line()]);
      t.onOrderSaved();
      expect(alert['errorUnauthorized']).toHaveBeenCalled();
      t.onOrderConfirmed(cash);
      expect(checkoutClose).toHaveBeenCalled();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
    });

    it('checkout opens the modal; guards for permission/empty/busy', () => {
      t.checkout();
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      t.isCancellingOrder.set(true);
      t.checkout();
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      t.isCancellingOrder.set(false);
      t.clearAll();
      t.checkout();
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
    });

    it('checkout shows how a customer link order was paid for, so staff do not enter it again', () => {
      t.isEditMode.set(true);
      t.currentOrder.set(
        order({
          source: OrderSourceEnum.CustomerLink,
          paymentMethod: PaymentMethodEnum.Cash,
          amountReceived: 500,
          tips: 20,
        }),
      );
      t.checkout();
      expect(checkoutOpen).toHaveBeenCalledWith({
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 500,
        tips: 20,
      });
    });

    it('checkout starts empty for an order staff took themselves', () => {
      t.isEditMode.set(true);
      t.currentOrder.set(order({ source: OrderSourceEnum.Pos, paymentMethod: PaymentMethodEnum.Cash }));
      t.checkout();
      expect(checkoutOpen).toHaveBeenCalledWith(null);
    });

    describe('chat with the customer', () => {
      const linkOrder = (over: Partial<OrderDto> = {}) =>
        order({ source: OrderSourceEnum.CustomerLink, status: OrderStatusEnum.Pending, customerName: 'Maria Cruz', ...over });
      const hasChat = () => (t as unknown as { hasChat: () => boolean }).hasChat();
      const chatButton = () => fixture.nativeElement.querySelector('[data-chat-button]') as HTMLButtonElement | null;
      const panel = () => fixture.nativeElement.querySelector('[data-order-chat]') as HTMLElement;
      const unread = () => (t as unknown as { chatUnread: () => number }).chatUnread();

      it('is offered for a customer order that is open', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        fixture.detectChanges();

        expect(hasChat()).toBe(true);
        expect(chatButton()).not.toBeNull();
      });

      it.each([
        ['an order the shop took itself', { source: OrderSourceEnum.Pos }],
      ])('is not offered for %s', (_name, over) => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder(over as Partial<OrderDto>));
        fixture.detectChanges();

        expect(hasChat()).toBe(false);
        expect(chatButton()).toBeNull();
      });

      it('is not offered for a new order that has not been saved', () => {
        t.currentOrder.set(linkOrder());
        fixture.detectChanges();

        expect(hasChat()).toBe(false);
      });

      it('counts the messages nobody has read', () => {
        unreadByOrder['o1'] = 2;
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        fixture.detectChanges();

        expect(unread()).toBe(2);
        expect(chatButton()!.querySelector('[data-chat-unread]')!.textContent!.trim()).toBe('2');
      });

      it('opens the chat in the side panel with the order and the customer', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder({ orderNumber: 1042 }));
        fixture.detectChanges();

        chatButton()!.click();
        fixture.detectChanges();

        expect(panel().className).toContain('translate-x-0');
        expect(chatApi.getOrderConversation).toHaveBeenCalledWith('o1');
        expect(panel().textContent).toContain('Maria Cruz');
      });

      it('opens straight away from a notification (?chat=open), then clears the parameter', () => {
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        fixture.detectChanges();

        queryParams$.next(convertToParamMap({ chat: 'open' }));
        fixture.detectChanges();

        expect(panel().className).toContain('translate-x-0');
        expect(navigate).toHaveBeenCalledWith([], {
          queryParams: { chat: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    describe('marking a customer order ready', () => {
      const linkOrder = (over: Partial<OrderDto> = {}) =>
        order({ source: OrderSourceEnum.CustomerLink, status: OrderStatusEnum.Pending, ...over });
      const markReady = () => (t as unknown as { markReady: () => void }).markReady();
      const canMarkReady = () => (t as unknown as { canMarkReady: () => boolean }).canMarkReady();
      const readyLabel = () => (t as unknown as { readyLabel: () => string }).readyLabel();

      it('is offered for an accepted customer order not yet ready', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        expect(canMarkReady()).toBe(true);
      });

      it.each([
        ['an order the shop took itself', { source: OrderSourceEnum.Pos }],
        ['an order already marked ready', { readyAt: '2026-10-12T10:00:00Z' }],
        ['a completed order', { status: OrderStatusEnum.Completed }],
        ['a cancelled order', { status: OrderStatusEnum.Cancelled }],
      ])('is not offered for %s', (_name, over) => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder(over as Partial<OrderDto>));
        expect(canMarkReady()).toBe(false);
      });

      it('is not offered without permission', async () => {
        canWrite = false;
        await start();
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        expect(canMarkReady()).toBe(false);
      });

      it('is labelled for pickup or for delivery', () => {
        t.currentOrder.set(linkOrder({ fulfillmentType: FulfillmentTypeEnum.Pickup }));
        expect(readyLabel()).toBe('Ready for pickup');
        t.currentOrder.set(linkOrder({ fulfillmentType: FulfillmentTypeEnum.Delivery }));
        expect(readyLabel()).toBe('Ready for delivery');
      });

      it('marks it ready, keeps the updated order and tells the staff', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder({ fulfillmentType: FulfillmentTypeEnum.Delivery }));
        const updated = linkOrder({
          fulfillmentType: FulfillmentTypeEnum.Delivery,
          readyAt: '2026-10-12T10:00:00Z',
        });
        orderService['markOrderReady'].mockReturnValue(of(updated));

        markReady();

        expect(orderService['markOrderReady']).toHaveBeenCalledWith('o1');
        expect(t.currentOrder()).toEqual(updated);
        expect(canMarkReady()).toBe(false);
        expect(alert['success']).toHaveBeenCalledWith('Order #5 marked ready for delivery.');
      });

      it('shows the server message and stays available when it fails', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder());
        orderService['markOrderReady'].mockReturnValue(
          throwError(() => new Error('This order cannot be marked ready.')),
        );

        markReady();

        expect(alert['error']).toHaveBeenCalledWith('This order cannot be marked ready.');
        expect(canMarkReady()).toBe(true);
      });

      it('does nothing when it is not allowed or already running', () => {
        t.isEditMode.set(true);
        t.currentOrder.set(linkOrder({ source: OrderSourceEnum.Pos }));
        markReady();
        expect(orderService['markOrderReady']).not.toHaveBeenCalled();
      });
    });

    it('checkout is refused without write permission', async () => {
      canWrite = false;
      await start();
      withCart([line()]);
      t.checkout();
      expect(alert['errorUnauthorized']).toHaveBeenCalled();
      expect(checkoutOpen).not.toHaveBeenCalled();
    });

    it('onOrderConfirmed with invalid price closes the modal', () => {
      withCart([line({ price: 1, addOns: [{ addOnId: 'x', name: 'X', price: -5 }] })]);
      t.onOrderConfirmed(cash);
      expect(checkoutClose).toHaveBeenCalled();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
    });
  });

  describe('quick pay hold', () => {
    it('completes after holding for a second and opens checkout', async () => {
      await start();
      withCart([line()]);
      vi.useFakeTimers();
      t.startQuickPayHold();
      expect(t.isQuickPayHolding()).toBe(true);
      vi.advanceTimersByTime(500);
      expect(t.quickPayProgress()).toBeGreaterThan(0);
      expect(checkoutOpen).not.toHaveBeenCalled();
      vi.advanceTimersByTime(700);
      expect(checkoutOpen).toHaveBeenCalledTimes(1);
      expect(t.isQuickPayHolding()).toBe(false);
      expect(t.quickPayProgress()).toBe(0);
    });

    it('releasing early cancels', async () => {
      await start();
      withCart([line()]);
      vi.useFakeTimers();
      t.startQuickPayHold();
      vi.advanceTimersByTime(300);
      t.cancelQuickPayHold();
      vi.advanceTimersByTime(2000);
      expect(checkoutOpen).not.toHaveBeenCalled();
      expect(t.isQuickPayHolding()).toBe(false);
    });

    it('does not start with an empty cart', async () => {
      await start();
      t.startQuickPayHold();
      expect(t.isQuickPayHolding()).toBe(false);
    });

    it('does not start without permission', async () => {
      canWrite = false;
      await start();
      withCart([line()]);
      t.startQuickPayHold();
      expect(t.isQuickPayHolding()).toBe(false);
    });
  });

  describe('layout helpers', () => {
    beforeEach(async () => {
      await start();
    });

    it('cart drawer drag dismisses past threshold', () => {
      t.openMobileCart();
      expect(t.showMobileCart()).toBe(true);
      const touch = (y: number) => ({ touches: [{ clientY: y }] }) as unknown as TouchEvent;
      t.onCartDragMove(touch(10));
      expect(t.cartDragY()).toBe(0);
      t.onCartDragStart(touch(100));
      t.onCartDragMove(touch(50));
      expect(t.cartDragY()).toBe(0);
      t.onCartDragMove(touch(300));
      expect(t.cartDragY()).toBe(200);
      t.onCartDragEnd();
      expect(t.showMobileCart()).toBe(false);
      expect(t.isCartDragging()).toBe(false);

      t.openMobileCart();
      t.onCartDragStart(touch(100));
      t.onCartDragMove(touch(160));
      t.onCartDragEnd();
      expect(t.showMobileCart()).toBe(true);
      t.onCartDragEnd();
      t.closeMobileCart();
      expect(t.showMobileCart()).toBe(false);
    });

    it('collapses cart', () => {
      t.toggleCartCollapse();
      expect(t.isCartCollapsed()).toBe(true);
      t.openMobileCart();
      expect(t.isCartCollapsed()).toBe(false);
      t.onRailTriggerLeave();
      expect(t.isRailTriggerHovering()).toBe(false);
    });

    it('has no back button on a new order, but has one when editing an existing order', () => {
      const back = () => fixture.nativeElement.querySelector('[aria-label="Back to orders"]');
      fixture.detectChanges();
      expect(t.isEditMode()).toBe(false);
      expect(back()).toBeNull();

      t.isEditMode.set(true);
      fixture.detectChanges();
      expect(back()).not.toBeNull();
    });

    it('cancel navigates to list', () => {
      t.cancel();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('status helpers', () => {
      expect(t.getPaymentMethodLabel(PaymentMethodEnum.Cash)).toBe('Cash');
      expect(t.getPaymentMethodLabel(PaymentMethodEnum.GCash)).toBe('GCash');
      expect(t.getPaymentMethodLabel(undefined)).toBe('N/A');
      expect(t.getStatusVariant(OrderStatusEnum.Pending)).toBe('warning');
      expect(t.getStatusVariant(OrderStatusEnum.Completed)).toBe('success');
      expect(t.getStatusVariant(OrderStatusEnum.Cancelled)).toBe('default');
      expect(t.getStatusVariant(OrderStatusEnum.Refunded)).toBe('error');
      expect(t.getStatusVariant(null)).toBe('info');
      expect(t.getStatusLabel(OrderStatusEnum.Pending)).toBe('Pending');
      expect(t.getStatusLabel(OrderStatusEnum.Completed)).toBe('Completed');
      expect(t.getStatusLabel(OrderStatusEnum.Cancelled)).toBe('Cancelled');
      expect(t.getStatusLabel(OrderStatusEnum.Refunded)).toBe('Refunded');
      expect(t.getStatusLabel(null)).toBe('Unknown');
      expect(t.getStatusLabel(OrderStatusEnum.PendingApproval)).toBe('Awaiting approval');
      expect(t.getStatusVariant(OrderStatusEnum.PendingApproval)).toBe('amber');
      expect(t.getOrderDateValue(order({ createdAt: '', updatedAt: 'u' }))).toBe('u');
    });

    it('receipt download toggles flag even on failure', async () => {
      const inst = fixture.componentInstance as unknown as {
        orderReceipt: () => { generate: () => Promise<void> };
      };
      const gen = vi.spyOn(inst.orderReceipt(), 'generate').mockResolvedValue(undefined);
      await t.downloadOrderImage();
      expect(gen).toHaveBeenCalled();
      gen.mockRejectedValue(new Error('x'));
      await expect(t.downloadOrderImage()).rejects.toThrow('x');
    });

    it('receipt data for a new order uses cart state', () => {
      withCart([line({ qty: 2 })]);
      t.orderSpecialInstructions.set('note');
      const r = t.receiptData();
      expect(r.orderNumber).toBeNull();
      expect(r.customerName).toBe('Walk-in customer');
      expect(r.status).toBe(OrderStatusEnum.Pending);
      expect(r.totalAmount).toBe(200);
      expect(r.specialInstructions).toBe('note');
    });

    it('scroll handler ignores non-element targets and empty sections', () => {
      const ev = { currentTarget: null } as unknown as Event;
      t.onCatalogContentScrolled(ev);
      const div = document.createElement('div');
      t.onCatalogContentScrolled({ currentTarget: div } as unknown as Event);
      expect(t.activeCatalogTab()).toBe('products');
    });

    it('renders the cart lines', () => {
      withCart([line({ qty: 2, addOns: [shotAddOn()], specialInstructions: 'hot' })]);
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Latte');
      expect(text).toContain('hot');
    });
  });

  describe('abandon guard', () => {
    beforeEach(async () => {
      await start();
    });

    it('allows leaving with an empty cart', () => {
      expect(t.canDeactivate()).toBe(true);
    });

    it('blocks and asks when the cart has changes; confirm resolves true', async () => {
      withCart([line()]);
      const result = t.canDeactivate() as Promise<boolean>;
      expect(t.showAbandonModal()).toBe(true);
      expect(modalStack.hasOpen()).toBe(true);
      t.confirmAbandon();
      await expect(result).resolves.toBe(true);
      expect(t.showAbandonModal()).toBe(false);
      expect(modalStack.hasOpen()).toBe(false);
    });

    it('cancel resolves false, as does popping the modal stack', async () => {
      withCart([line()]);
      const result = t.canDeactivate() as Promise<boolean>;
      t.cancelAbandon();
      await expect(result).resolves.toBe(false);

      const second = t.canDeactivate() as Promise<boolean>;
      modalStack.pop();
      await expect(second).resolves.toBe(false);
      expect(t.showAbandonModal()).toBe(false);
    });

    it('does not ask when unauthenticated or after a successful save', () => {
      withCart([line()]);
      authenticated = false;
      expect(t.canDeactivate()).toBe(true);
      authenticated = true;
      t.onOrderSaved();
      expect(t.canDeactivate()).toBe(true);
    });

    it('confirm/cancel without pending promise is harmless', () => {
      t.confirmAbandon();
      t.cancelAbandon();
      expect(t.showAbandonModal()).toBe(false);
    });
  });

  describe('edit mode (online order)', () => {
    const pendingOrder = () =>
      order({
        id: 'o1',
        customerId: 'c1',
        specialInstructions: 'saved note',
        items: [
          {
            id: 'i1',
            productId: 'latte',
            productName: 'Latte',
            quantity: 2,
            price: 100,
            specialInstructions: 'hot',
            addOns: [
              { id: 'a', productId: 'shot', productName: 'Shot', quantity: 2, price: 20, addOns: [] },
            ],
          },
          { id: 'i2', productId: 'chips', productName: 'Chips', quantity: 4, price: 0, addOns: [], bundlePromotionId: 'b1' },
          { id: 'i3', productId: 'latte', productName: 'Latte', quantity: 2, price: 0, addOns: [], bundlePromotionId: 'b1', specialInstructions: 'cut' },
        ],
        bundlePromotions: [{ promotionId: 'b1', promotionName: 'Combo', quantity: 2, unitPrice: 150 }],
        totalAmount: 500,
      });

    beforeEach(() => {
      params = { id: 'o1' };
      orderService['getOrder'].mockReturnValue(of(pendingOrder()));
      catalog.getAddOnsForProduct.mockImplementation((id: string) =>
        id === 'latte'
          ? [{ type: AddOnTypeEnum.Extra, displayName: 'Extra', options: [{ ...P_SHOT, overridePrice: 15 }] }]
          : [],
      );
    });

    it('a line the shop saved in two parts (a limit covered only some) is one line again', async () => {
      orderService['getOrder'].mockReturnValue(
        of(
          order({
            status: OrderStatusEnum.Pending,
            items: [
              { id: 'i1', productId: 'latte', productName: 'Latte', quantity: 2, price: null, addOns: [], discountPromotionId: 'd' },
              { id: 'i2', productId: 'latte', productName: 'Latte', quantity: 3, price: null, addOns: [] },
            ],
          }),
        ),
      );

      await start();

      expect(t.cart().length).toBe(1);
      expect(t.cart()[0]).toMatchObject({ productId: 'latte', qty: 5 });
    });

    it('loads a pending order into the cart and enriches it', async () => {
      await start();
      expect(t.isEditMode()).toBe(true);
      expect(t.isLoading()).toBe(false);
      expect(orderService['getOrder']).toHaveBeenCalledWith('o1');
      expect(customerService['getCustomers']).toHaveBeenCalled();
      expect(productService.getProducts).toHaveBeenCalledTimes(2);
      expect(t.selectedCustomerId()).toBe('c1');
      expect(t.orderSpecialInstructions()).toBe('saved note');
      expect(t.cart().length).toBe(2);
      const regular = t.cart()[0];
      expect(regular).toMatchObject({ name: 'Latte', qty: 2, specialInstructions: 'hot' });
      expect(regular.addOns?.length).toBe(2);
      expect(regular.addOns?.[0]).toMatchObject({ addOnId: 'shot', name: 'Shot', price: 15, addOnType: AddOnTypeEnum.Extra });
      const bundle = t.cart()[1];
      expect(bundle).toMatchObject({
        productId: 'b1',
        name: 'Combo',
        qty: 2,
        price: 150,
        bundlePromotionId: 'b1',
        specialInstructions: 'cut',
      });
      expect(bundle.bundleItems?.map((b) => [b.name, b.qty])).toEqual([
        ['Chips', 2],
        ['Latte', 1],
      ]);
      expect(t.canEditOrderSpecialInstructions()).toBe(true);
      expect(t.canEditCustomerSelection()).toBe(true);
      expect(t.isCancellable()).toBe(true);
      expect(t.paymentOrderTotal()).toBe(500);
      expect(persistence['load']).not.toHaveBeenCalled();
    });

    it('uses a single products request when no add-ons are present', async () => {
      orderService['getOrder'].mockReturnValue(
        of(order({ items: [{ id: 'i', productId: 'cola', productName: 'Cola', quantity: 1, price: 50, addOns: [] }] })),
      );
      await start();
      expect(productService.getProducts).toHaveBeenCalledTimes(1);
      expect(t.cart()[0].name).toBe('Cola');
      expect(t.cart()[0].imageUrl).toBeNull();
    });

    it('mix and match children keep raw quantity when the promotion type is known', async () => {
      catalog.bundlePromotions.set([bundlePromo({ typeId: PromotionTypeEnum.MixMatch })]);
      fixture = TestBed.createComponent(OrderEditor);
      t = fixture.componentInstance as unknown as Editor;
      fixture.detectChanges();
      TestBed.tick();
      await settle();
      const bundle = t.cart().find((c) => c.bundlePromotionId === 'b1');
      expect(bundle).toBeDefined();
    });

    it('does not persist edits to the local cart', async () => {
      await start();
      TestBed.tick();
      t.onAddonSelected({ product: P_COLA, addOns: [], quantity: 1 });
      TestBed.tick();
      expect(persistence['save']).not.toHaveBeenCalled();
    });

    it('redirects away from completed orders', async () => {
      orderService['getOrder'].mockReturnValue(of(order({ status: OrderStatusEnum.Completed })));
      await start();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
      expect(t.cart()).toEqual([]);
    });

    it('never opens an order waiting for approval for editing: it goes to the details page', async () => {
      orderService['getOrder'].mockReturnValue(
        of(order({ status: OrderStatusEnum.PendingApproval })),
      );
      await start();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
      expect(t.cart()).toEqual([]);
    });

    it('load failure alerts', async () => {
      orderService['getOrder'].mockReturnValue(throwError(() => new Error('')));
      await start();
      expect(alert['error']).toHaveBeenCalledWith('load order failed');
      expect(t.isLoading()).toBe(false);
    });

    it('updates a pending order (save) and completes it with payment', async () => {
      await start();
      t.onOrderSaved();
      expect(orderService['updateOrder']).toHaveBeenCalledTimes(1);
      const cmd = orderService['updateOrder'].mock.calls[0][0];
      expect(cmd).toMatchObject({
        id: 'o1',
        status: OrderStatusEnum.Pending,
        customerId: 'c1',
        specialInstructions: 'saved note',
      });
      expect(cmd.bundlePromotions).toEqual([{ promotionId: 'b1', quantity: 2 }]);
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);

      t.onOrderConfirmed(cash);
      expect(orderService['updateOrder'].mock.calls[1][0]).toMatchObject({
        status: OrderStatusEnum.Completed,
        paymentMethod: PaymentMethodEnum.Cash,
        tips: 10,
      });
    });

    it('update error alerts; stale order error navigates to list', async () => {
      await start();
      orderService['updateOrder'].mockReturnValue(throwError(() => new Error('')));
      t.onOrderSaved();
      expect(alert['error']).toHaveBeenCalledWith('update order failed');
      expect(nav).not.toHaveBeenCalled();

      orderService['updateOrder'].mockReturnValue(
        throwError(() => new Error('Order is already completed and cannot be updated')),
      );
      t.onOrderSaved();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('detects unsaved changes against the loaded snapshot', async () => {
      await start();
      expect(t.canDeactivate()).toBe(true);
      t.onCustomerSelected('c9');
      const p = t.canDeactivate();
      expect(p).toBeInstanceOf(Promise);
      t.cancelAbandon();
      await p;
      t.onCustomerSelected('c1');
      expect(t.canDeactivate()).toBe(true);
      t.increment('latte', 0);
      const p2 = t.canDeactivate();
      expect(p2).toBeInstanceOf(Promise);
      t.confirmAbandon();
    });

    it('cancelling a pending order requires no note and navigates to list', async () => {
      await start();
      t.openCancelOrderModal();
      expect(t.showCancelOrderModal()).toBe(true);
      t.confirmCancelOrder();
      expect(orderService['voidOrder']).toHaveBeenCalledWith('o1', null);
      expect(alert['success']).toHaveBeenCalledWith('Order has been cancelled');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
      expect(t.showCancelOrderModal()).toBe(false);
    });

    it('cancel order failure alerts', async () => {
      await start();
      orderService['voidOrder'].mockReturnValue(throwError(() => new Error('')));
      t.openCancelOrderModal();
      t.confirmCancelOrder();
      expect(alert['error']).toHaveBeenCalledWith('update order failed');
      expect(t.isCancellingOrder()).toBe(false);
    });

    it('cancel note input and dismiss', async () => {
      await start();
      t.openCancelOrderModal();
      const ta = document.createElement('textarea');
      ta.value = ' why ';
      const ev = new Event('input');
      Object.defineProperty(ev, 'target', { value: ta });
      t.onCancelOrderNoteInput(ev);
      expect(t.cancelOrderNote()).toBe(' why ');
      t.onCancelOrderNoteInput(new Event('input'));
      expect(t.cancelOrderNote()).toBe('');
      t.dismissCancelOrder();
      expect(t.showCancelOrderModal()).toBe(false);
      expect(modalStack.hasOpen()).toBe(false);
    });

    it('cancel order modal requires permission', async () => {
      canWrite = false;
      await start();
      t.openCancelOrderModal();
      t.confirmCancelOrder();
      expect(alert['errorUnauthorized']).toHaveBeenCalledTimes(2);
      expect(orderService['voidOrder']).not.toHaveBeenCalled();
    });
  });

  describe('completed order override', () => {
    const completed = () =>
      order({
        status: OrderStatusEnum.Completed,
        paymentMethod: PaymentMethodEnum.Cash,
        amountReceived: 600,
        changeAmount: 100,
        tips: 5,
        totalAmount: 500,
        note: 'prev',
        items: [{ id: 'i', productId: 'latte', productName: 'Latte', quantity: 1, price: 100, addOns: [] }],
      });

    beforeEach(() => {
      params = { id: 'o1' };
      query = { override: '1' };
      orderService['getOrder'].mockReturnValue(of(completed()));
    });

    it('enters override mode for authorized users', async () => {
      await start();
      expect(t.isOverrideMode()).toBe(true);
      expect(t.isReadOnly()).toBe(false);
      expect(t.isCompleted()).toBe(true);
      expect(t.cart().length).toBe(1);
      expect(t.canEditCustomerSelection()).toBe(true);
      expect(t.paymentAmountPaid()).toBe(600);
      expect(t.paymentTipsAmount()).toBe(5);
      expect(t.paymentChangeAmount()).toBe(100);
      expect(t.paymentTotalPaid()).toBe(500);
      expect(t.receiptTotalAmount()).toBe(500);
    });

    it('redirects to details without override permission', async () => {
      canOverride = false;
      await start();
      expect(t.isOverrideMode()).toBe(false);
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
    });

    it('payment flow opens the override reason modal instead of saving', async () => {
      await start();
      t.onOrderConfirmed(cash);
      expect(checkoutClose).toHaveBeenCalled();
      expect(t.showOverrideModal()).toBe(true);
      expect(orderService['updateOrder']).not.toHaveBeenCalled();
    });

    it('requires a reason, then submits override', async () => {
      await start();
      t.onOrderConfirmed(cash);
      t.confirmOverride();
      expect(t.showOverrideReasonError()).toBe(true);
      expect(alert['error']).toHaveBeenCalledWith('Override reason is required.');
      expect(orderService['overrideOrder']).not.toHaveBeenCalled();

      const ta = document.createElement('textarea');
      ta.value = '  wrong item ';
      const ev = new Event('input');
      Object.defineProperty(ev, 'target', { value: ta });
      t.onOverrideReasonInput(ev);
      expect(t.showOverrideReasonError()).toBe(false);
      t.confirmOverride();
      expect(orderService['overrideOrder']).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'o1',
          status: OrderStatusEnum.Completed,
          overrideReason: 'wrong item',
          paymentMethod: PaymentMethodEnum.Cash,
          amountReceived: 500,
          changeAmount: 300,
          tips: 10,
        }),
      );
      expect(alert['success']).toHaveBeenCalledWith('Order has been overridden');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
      expect(persistence['clear']).toHaveBeenCalled();
      expect(t.showOverrideModal()).toBe(false);
    });

    it('override failure alerts and can be dismissed', async () => {
      await start();
      t.onOrderConfirmed(cash);
      t.onOverrideReasonInput(
        Object.defineProperty(new Event('input'), 'target', {
          value: Object.assign(document.createElement('textarea'), { value: 'r' }),
        }),
      );
      orderService['overrideOrder'].mockReturnValue(throwError(() => new Error('')));
      t.confirmOverride();
      expect(alert['error']).toHaveBeenCalledWith('update order failed');
      expect(t.isSavingOrder()).toBe(false);
      t.dismissOverride();
      expect(t.showOverrideModal()).toBe(false);
    });

    it('override refuses when permission is revoked and ignores missing payment', async () => {
      await start();
      t.confirmOverride();
      expect(orderService['overrideOrder']).not.toHaveBeenCalled();
      t.onOrderConfirmed(cash);
      canOverride = false;
      t.confirmOverride();
      expect(alert['errorUnauthorized']).toHaveBeenCalled();
    });

    it('dismissOverride is ignored while saving', async () => {
      await start();
      t.onOrderConfirmed(cash);
      t.isSavingOrder.set(true);
      t.dismissOverride();
      expect(t.showOverrideModal()).toBe(true);
    });

    it('cancelOverride returns to the order details', async () => {
      await start();
      t.cancelOverride();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrderDetailsById('o1'));
    });

    it('refunding a completed order demands a note', async () => {
      await start();
      t.openCancelOrderModal();
      expect(t.cancelOrderNote()).toBe('prev');
      t.onCancelOrderNoteInput(
        Object.defineProperty(new Event('input'), 'target', {
          value: Object.assign(document.createElement('textarea'), { value: '  ' }),
        }),
      );
      t.confirmCancelOrder();
      expect(t.showCancelOrderNoteError()).toBe(true);
      expect(alert['error']).toHaveBeenCalledWith('Refund note is required.');
      expect(orderService['voidOrder']).not.toHaveBeenCalled();

      t.onCancelOrderNoteInput(
        Object.defineProperty(new Event('input'), 'target', {
          value: Object.assign(document.createElement('textarea'), { value: 'refund me' }),
        }),
      );
      t.confirmCancelOrder();
      expect(orderService['voidOrder']).toHaveBeenCalledWith('o1', 'refund me');
      expect(alert['success']).toHaveBeenCalledWith('Order has been refunded');
    });
  });

  describe('offline order editing', () => {
    const pending = () => ({
      localId: 'OFF-1',
      command: {
        status: OrderStatusEnum.Pending,
        customerId: 'c1',
        specialInstructions: 'q',
        items: [],
      },
      cartSnapshot: [line({ qty: 2 })],
      customerName: 'Jane Doe',
      createdAt: '',
      status: 'pending',
      retryCount: 0,
    });

    beforeEach(() => {
      query = { offline: 'OFF-1' };
      offline['get'].mockResolvedValue(pending());
    });

    it('loads the queued order and locks sync', async () => {
      await start();
      expect(offline['lockSyncForOfflineEdit']).toHaveBeenCalledWith('OFF-1');
      expect(t.isEditMode()).toBe(true);
      expect(t.isOfflineEditMode()).toBe(true);
      expect(t.cart()[0].qty).toBe(2);
      expect(t.selectedCustomerId()).toBe('c1');
      expect(t.orderSpecialInstructions()).toBe('q');
      expect(t.offlineOrderStatus()).toBe(OrderStatusEnum.Pending);
      expect(t.isLoading()).toBe(false);
      expect(t.receiptData().orderLabel).toBe('OFF-1');
      expect(t.canEditCustomerSelection()).toBe(true);
    });

    it('unlocks sync on destroy', async () => {
      await start();
      fixture.destroy();
      expect(offline['unlockSyncForOfflineEdit']).toHaveBeenCalledWith('OFF-1');
    });

    it('missing queued order alerts and navigates back', async () => {
      offline['get'].mockResolvedValue(undefined);
      await start();
      expect(alert['error']).toHaveBeenCalledWith('Offline order not found.');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
    });

    it('saves updates to the queued order, completing with payment', async () => {
      await start();
      t.onOrderSaved();
      expect(offline['update']).toHaveBeenCalledWith(
        'OFF-1',
        expect.objectContaining({ status: OrderStatusEnum.Pending, customerId: 'c1' }),
        t.cart(),
        'Jane Doe',
        expect.any(Number),
      );
      await settle();
      expect(alert['info']).toHaveBeenCalledWith('Order OFF-1 updated offline.');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);

      t.onOrderConfirmed(cash);
      expect(offline['update'].mock.calls[1][1]).toMatchObject({
        status: OrderStatusEnum.Completed,
        paymentMethod: PaymentMethodEnum.Cash,
      });
      expect(orderService['updateOrder']).not.toHaveBeenCalled();
      expect(orderService['createOrder']).not.toHaveBeenCalled();
    });

    it('update failure alerts', async () => {
      await start();
      offline['update'].mockRejectedValue(new Error('x'));
      t.onOrderSaved();
      await settle();
      expect(alert['error']).toHaveBeenCalledWith('Failed to update offline order.');
      expect(t.isSavingOrder()).toBe(false);
    });

    it('completed offline orders are read only', async () => {
      offline['get'].mockResolvedValue({
        ...pending(),
        command: { ...pending().command, status: OrderStatusEnum.Completed },
      });
      await start();
      expect(t.isOfflineCompleted()).toBe(true);
      expect(t.isReadOnly()).toBe(true);
      expect(t.canEditOrderSpecialInstructions()).toBe(false);
      expect(t.canEditCustomerSelection()).toBe(false);
      expect(t.canDeactivate()).toBe(true);
    });

    it('discards the queued order after confirmation', async () => {
      await start();
      t.openDiscardOrderModal();
      expect(t.showDiscardOrderModal()).toBe(true);
      t.confirmDiscardOrder();
      expect(offline['remove']).toHaveBeenCalledWith('OFF-1');
      await settle();
      expect(alert['success']).toHaveBeenCalledWith('Order OFF-1 discarded.');
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
      expect(t.showDiscardOrderModal()).toBe(false);
    });

    it('dismissing discard modal keeps the order', async () => {
      await start();
      t.openDiscardOrderModal();
      t.dismissDiscardOrder();
      expect(t.showDiscardOrderModal()).toBe(false);
      expect(modalStack.hasOpen()).toBe(false);
      expect(offline['remove']).not.toHaveBeenCalled();
    });

    it('discard without a local id does nothing', async () => {
      query = {};
      await start();
      t.confirmDiscardOrder();
      expect(offline['remove']).not.toHaveBeenCalled();
    });
  });

  describe('read-only states', () => {
    it('cancelled and refunded orders are read-only and not cancellable', async () => {
      params = { id: 'o1' };
      orderService['getOrder'].mockReturnValue(of(order()));
      await start();
      t.currentOrder.set(order({ status: OrderStatusEnum.Cancelled }));
      expect(t.isReadOnly()).toBe(true);
      expect(t.isCancellable()).toBe(false);
      t.currentOrder.set(order({ status: OrderStatusEnum.Refunded }));
      expect(t.isReadOnly()).toBe(true);
      t.currentOrder.set(order({ status: OrderStatusEnum.Completed }));
      expect(t.isReadOnly()).toBe(true);
      expect(t.isCancellable()).toBe(true);
      expect(t.canEditOrderSpecialInstructions()).toBe(false);
    });
  });
});
