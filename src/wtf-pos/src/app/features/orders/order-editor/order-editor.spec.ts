import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AlertService,
  AuthService,
  CartPersistenceService,
  CatalogCacheService,
  ConnectivityService,
  CustomerService,
  ModalStackService,
  OfflineOrderService,
  OrderService,
  ProductService,
  PromotionService,
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
  OrderStatusEnum,
  PaymentMethodEnum,
  ProductCategoryEnum,
  ProductDto,
  ProductSubCategoryEnum,
  PromotionListItemDto,
  PromotionTypeEnum,
} from '@shared/models';
import { of, throwError } from 'rxjs';
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
  isEditMode: () => boolean;
  isOfflineEditMode: () => boolean;
  isOverrideMode: Sig<boolean>;
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
  getUnitAddOnTotal: (i: CartItemDto) => number;
  getDiscountedUnitPrice: (i: CartItemDto) => number | null;
  getUnitSubtotal: (i: CartItemDto) => number;
  getLineTotal: (i: CartItemDto) => number;
  getDiscountedAmount: (i: CartItemDto) => number;
  getDiscountedPromoLabel: (i: CartItemDto) => string | null;
  getBundleChildTotalQuantity: (
    l: CartItemDto,
    c: { productId: string; name: string; price: number; qty: number },
  ) => number;
  getSortedBundleItems: (i: CartItemDto) => { name: string }[];
  getGroupedAddOns: (i: CartItemDto) => { addOnId: string; quantityPerUnit: number; lineTotal: number }[];
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
  let isOnline: ReturnType<typeof signal<boolean>>;
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
          },
        },
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
        promoLabel: expect.stringContaining('Promo -'),
        promoRules: [{ fixedPrice: 10, percentOff: null, addOns: [] }],
      });
      t.addToCart(P_COLA);
      expect(selectorOpen).toHaveBeenLastCalledWith(P_COLA, { promoLabel: null, promoRules: [] });
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

  describe('promotions and totals', () => {
    const promos = (items: object[]): DiscountedProductPromotionDto[] => [
      {
        id: 'd',
        name: 'D',
        isActive: true,
        startDate: null,
        endDate: null,
        items: items as DiscountedProductPromotionDto['items'],
      },
    ];

    it('plain line totals include add-ons', async () => {
      await start();
      const l = line({ qty: 2, addOns: [shotAddOn(), shotAddOn()] });
      expect(t.getUnitAddOnTotal(l)).toBe(40);
      expect(t.getUnitSubtotal(l)).toBe(140);
      expect(t.getLineTotal(l)).toBe(280);
      expect(t.getDiscountedUnitPrice(l)).toBeNull();
      expect(t.getDiscountedAmount(l)).toBe(0);
      expect(t.getDiscountedPromoLabel(l)).toBeNull();
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

    it('sorts bundle items and groups add-ons', async () => {
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
      const groups = t.getGroupedAddOns(l);
      expect(groups[0]).toMatchObject({ addOnId: 'shot', quantityPerUnit: 2, lineTotal: 80 });
      expect(groups[1].lineTotal).toBe(-10);
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
        'This bundle promotion is not active in your local timezone.',
      );
      expect(promotionService['getFixedBundle']).not.toHaveBeenCalled();
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
      );
      await settle();
      expect(alert['info']).toHaveBeenCalledWith(
        "Order OFF-1 saved offline. It will sync when you're back online.",
      );
      expect(persistence['clear']).toHaveBeenCalled();
      expect(nav).toHaveBeenCalledWith(AppRoutes.OrdersList);
      expect(t.isSavingOrder()).toBe(false);
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
