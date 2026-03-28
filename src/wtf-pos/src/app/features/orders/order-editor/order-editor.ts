import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
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
import type { CustomerDropdownOption, ReceiptData } from '@shared/components';
import {
  AddonSelectorComponent,
  AvatarComponent,
  BadgeComponent,
  CartDrawerComponent,
  CustomerDropdownComponent,
  IconComponent,
  OrderReceiptComponent,
  PullToRefreshComponent,
  SearchInputComponent,
} from '@shared/components';
import {
  AddOnGroupDto,
  ADD_ON_TYPE_ORDER,
  AddOnTypeEnum,
  CartAddOnDto,
  CartBundleItemDto,
  CartItemDto,
  CreateOrderCommand,
  CustomerDto,
  OrderDto,
  OrderItemRequestDto,
  OrderStatusEnum,
  PaymentMethodEnum,
  ProductCategoryEnum,
  ProductDto,
  FixedBundlePromotionDto,
  MixMatchPromotionDto,
  PromotionListItemDto,
  PromotionTypeEnum,
  ProductSubCategoryEnum,
  UpdateOrderCommand,
} from '@shared/models';
import { AppRoutes } from '@shared/constants/app-routes';
import { debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { CheckoutModal } from '../checkout-modal/checkout-modal';

interface BundleItemSource {
  productId: string;
  addOns: { addOnProductId: string; quantity: number }[];
  quantity?: number;
}

interface BundlePromotionSelection {
  id: string;
  name: string;
  typeId: PromotionTypeEnum;
  isActive: boolean;
  imageUrl?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  bundlePrice: number;
  requiredQuantity?: number;
  maxSelectionsPerOrder?: number | null;
  items: BundleItemSource[];
}

@Component({
  selector: 'app-order-editor',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    IconComponent,
    CheckoutModal,
    CartDrawerComponent,
    CustomerDropdownComponent,
    AddonSelectorComponent,
    AvatarComponent,
    BadgeComponent,
    PullToRefreshComponent,
    OrderReceiptComponent,
    SearchInputComponent,
  ],
  templateUrl: './order-editor.html',
})
export class OrderEditor implements OnInit, OnDestroy {
  private readonly checkoutModal = viewChild.required(CheckoutModal);
  private readonly addonSelector = viewChild.required(AddonSelectorComponent);
  private readonly orderReceipt = viewChild.required(OrderReceiptComponent);
  private readonly productService = inject(ProductService);
  private readonly promotionService = inject(PromotionService);
  private readonly orderService = inject(OrderService);
  private readonly customerService = inject(CustomerService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);
  private readonly modalStack = inject(ModalStackService);
  private readonly catalogCache = inject(CatalogCacheService);
  private readonly cartPersistence = inject(CartPersistenceService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineOrder = inject(OfflineOrderService);
  private readonly cdr = inject(ChangeDetectorRef);

  // Order-level special instructions state
  public readonly orderSpecialInstructions = signal('');
  protected readonly showOrderSpecialInstructions = signal(false);

  // Abandon order guard
  protected readonly showAbandonModal = signal(false);
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;
  private originalCartSnapshot = '';
  private abandonModalStackId: number | null = null;
  private cancelOrderModalStackId: number | null = null;
  private createCustomerModalStackId: number | null = null;
  private cartPersistenceReady = false;

  private readonly _ = effect(() => {
    const items = this.cart();
    const customerId = this.selectedCustomerId();
    const instructions = this.orderSpecialInstructions();

    if (!this.cartPersistenceReady || this.isEditMode()) {
      return;
    }

    if (items.length === 0) {
      this.cartPersistence.clear();
      return;
    }

    this.cartPersistence.save(items, customerId, instructions);
  });

  // Cancel order
  protected readonly showCancelOrderModal = signal(false);
  protected readonly cancelOrderNote = signal('');
  protected readonly showCancelOrderNoteError = signal(false);
  protected readonly showCreateCustomerModal = signal(false);
  protected readonly isCreatingCustomer = signal(false);
  protected readonly isSavingOrder = signal(false);
  protected readonly isCartCollapsed = signal(false);
  protected readonly quickPayProgress = signal(0);
  protected readonly isQuickPayHolding = signal(false);
  protected readonly isRailTriggerHovering = signal(false);
  protected readonly showMobileCart = signal(false);
  protected readonly cartDragY = signal(0);
  protected readonly isCartDragging = signal(false);
  private cartDragStartY = 0;
  private quickPayHoldRaf: number | null = null;
  private quickPayHoldStartMs: number | null = null;
  private readonly quickPayHoldDurationMs = 1000;
  protected readonly isRefreshing = signal(false);
  protected readonly isDownloadingReceipt = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';

  protected readonly createCustomerForm = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });

  protected readonly activeCatalogTab = signal<'products' | 'bundles'>('products');
  protected readonly selectedProductCategories = signal<ProductCategoryEnum[]>([]);
  protected readonly activeSubCategoryTab = signal<ProductSubCategoryEnum>(
    ProductSubCategoryEnum.Coffee,
  );
  protected readonly subCategoryTabs = [
    { id: ProductSubCategoryEnum.Coffee, label: 'Coffee', icon: 'icon-coffee' },
    { id: ProductSubCategoryEnum.NonCoffee, label: 'Non-Coffee', icon: 'icon-cold-drink' },
    { id: ProductSubCategoryEnum.Snacks, label: 'Snacks', icon: 'icon-snacks' },
  ];
  protected readonly cart = signal<CartItemDto[]>([]);
  protected readonly customers = signal<CustomerDto[]>([]);
  protected readonly products = signal<ProductDto[]>([]);
  protected readonly productsCache = signal<ProductDto[]>([]);
  protected readonly bundlePromotions = signal<PromotionListItemDto[]>([]);
  private readonly bundlePromotionsSync = effect(() => {
    this.bundlePromotions.set(this.catalogCache.bundlePromotions());
  });
  private readonly pendingBundleSelection = signal<BundlePromotionSelection | null>(null);
  protected readonly isLoadingPromotions = signal(false);
  protected readonly selectedCustomerId = signal<string | null>(null);
  protected readonly isLoadingCustomers = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly isEditMode = signal(false);
  protected readonly isOfflineEditMode = signal(false);
  protected readonly offlineOrderStatus = signal<OrderStatusEnum | null>(null);
  protected readonly showDiscardOrderModal = signal(false);
  protected readonly currentOrder = signal<OrderDto | null>(null);
  protected offlineLocalId: string | null = null;
  private discardOrderModalStackId: number | null = null;
  private offlineEditSyncLockActive = false;

  protected readonly isCompleted = computed(() => {
    const order = this.currentOrder();
    return order?.status === OrderStatusEnum.Completed;
  });

  protected readonly isCancelled = computed(() => {
    const order = this.currentOrder();
    return order?.status === OrderStatusEnum.Cancelled;
  });

  protected readonly isRefunded = computed(() => {
    const order = this.currentOrder();
    return order?.status === OrderStatusEnum.Refunded;
  });

  protected readonly isOfflineCompleted = computed(
    () => this.isOfflineEditMode() && this.offlineOrderStatus() === OrderStatusEnum.Completed,
  );

  protected readonly isReadOnly = computed(
    () =>
      this.isCompleted() || this.isCancelled() || this.isRefunded() || this.isOfflineCompleted(),
  );
  protected readonly paymentTipsAmount = computed(() => this.currentOrder()?.tips ?? 0);
  protected readonly paymentChangeAmount = computed(() => this.currentOrder()?.changeAmount ?? 0);
  protected readonly paymentOrderTotal = computed(
    () => this.currentOrder()?.totalAmount ?? this.totalPrice(),
  );
  protected readonly receiptTotalAmount = computed(() => {
    const order = this.currentOrder();
    const status = this.offlineOrderStatus() ?? order?.status ?? OrderStatusEnum.Pending;

    if (status === OrderStatusEnum.Pending) {
      return this.totalPrice();
    }

    return order?.totalAmount ?? this.totalPrice();
  });
  protected readonly paymentAmountPaid = computed(() => {
    const order = this.currentOrder();
    if (!order) {
      return 0;
    }

    if (order.amountReceived !== null && order.amountReceived !== undefined) {
      return order.amountReceived;
    }

    // For non-cash payments where amountReceived may be omitted, infer from total + tips.
    return this.paymentOrderTotal() + this.paymentTipsAmount();
  });
  protected readonly paymentTotalPaid = computed(
    () => this.paymentAmountPaid() - this.paymentChangeAmount(),
  );

  protected readonly isCancellable = computed(() => {
    const order = this.currentOrder();
    if (!order) {
      return false;
    }
    return order.status === OrderStatusEnum.Pending || order.status === OrderStatusEnum.Completed;
  });

  protected readonly canEditOrderSpecialInstructions = computed(() => {
    if (!this.canManageOrderActions()) {
      return false;
    }

    if (this.isOfflineEditMode()) {
      return !this.isOfflineCompleted();
    }

    if (!this.isEditMode()) {
      return true;
    }

    const order = this.currentOrder();
    return order?.status === OrderStatusEnum.Pending;
  });
  protected readonly canEditCustomerSelection = computed(() => {
    if (!this.canManageOrderActions()) {
      return false;
    }

    if (this.isOfflineEditMode()) {
      return !this.isOfflineCompleted();
    }

    if (!this.isEditMode()) {
      return true;
    }

    const order = this.currentOrder();
    return order?.status === OrderStatusEnum.Pending;
  });
  protected readonly canCreateCustomerInOrder = computed(() =>
    this.authService.canCreateCustomerInOrder(this.isEditMode()),
  );
  protected readonly canManageOrderActions = computed(() => this.authService.canManageOrders());
  protected readonly selectedCustomerName = computed(() => {
    const selectedId = this.selectedCustomerId();
    if (!selectedId) {
      return 'Walk-in customer';
    }

    const selected = this.customers().find((customer) => customer.id === selectedId);
    if (!selected) {
      return 'Unknown customer';
    }

    return `${selected.firstName} ${selected.lastName}`.trim();
  });
  protected readonly customerOptions = computed<CustomerDropdownOption[]>(() =>
    this.customers().map((customer) => ({
      id: customer.id,
      label: this.getCustomerDisplayName(customer),
    })),
  );

  protected readonly receiptData = computed<ReceiptData>(() => {
    const order = this.currentOrder();
    const offlineStatus = this.offlineOrderStatus();
    const dateOptions: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    };

    return {
      orderNumber: order?.orderNumber ?? null,
      orderLabel: this.isOfflineEditMode() ? this.offlineLocalId : null,
      customerName: this.selectedCustomerName(),
      date: order
        ? new Date(this.getOrderDateValue(order) || Date.now()).toLocaleString('en-PH', dateOptions)
        : new Date().toLocaleString('en-PH', dateOptions),
      status: offlineStatus ?? order?.status ?? OrderStatusEnum.Pending,
      items: this.cart(),
      specialInstructions: this.orderSpecialInstructions(),
      totalAmount: this.receiptTotalAmount(),
      paymentMethod: order?.paymentMethod ?? null,
      amountReceived: order?.amountReceived ?? null,
      changeAmount: order?.changeAmount ?? null,
      tips: order?.tips ?? null,
    };
  });

  protected itemCount = () => this.cart().reduce((s, i) => s + i.qty, 0);
  protected totalPrice = () => this.cart().reduce((s, i) => s + this.getLineTotal(i), 0);

  protected readonly categoryCounts = computed(() => {
    const cache = this.productsCache();
    return {
      [ProductCategoryEnum.Drink]: cache.filter((p) => p.category === ProductCategoryEnum.Drink)
        .length,
      [ProductCategoryEnum.Food]: cache.filter((p) => p.category === ProductCategoryEnum.Food)
        .length,
    };
  });

  protected readonly filteredBundlePromotions = computed(() => {
    const term = (this.filterForm.controls.searchTerm.value ?? '').trim().toLowerCase();
    let items = this.bundlePromotions().filter((promo) =>
      this.isPromotionActiveInUserTimezone(promo),
    );

    if (term) {
      items = items.filter((promo) => promo.name.toLowerCase().includes(term));
    }

    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  });

  protected selectSubCategoryTab(tab: ProductSubCategoryEnum): void {
    this.activeSubCategoryTab.set(tab);
    this.applyFiltersToCache();
  }

  protected selectCatalogTab(tab: 'products' | 'bundles'): void {
    this.activeCatalogTab.set(tab);
    this.filterForm.controls.searchTerm.setValue('');
  }

  protected onCartDragStart(event: TouchEvent): void {
    this.cartDragStartY = event.touches[0].clientY;
    this.cartDragY.set(0);
    this.isCartDragging.set(true);
  }

  protected onCartDragMove(event: TouchEvent): void {
    if (!this.isCartDragging()) {
      return;
    }
    const deltaY = event.touches[0].clientY - this.cartDragStartY;
    this.cartDragY.set(Math.max(0, deltaY));
  }

  protected onCartDragEnd(): void {
    if (!this.isCartDragging()) {
      return;
    }
    const shouldDismiss = this.cartDragY() > 150;
    this.isCartDragging.set(false);
    this.cartDragY.set(0);
    if (shouldDismiss) {
      this.showMobileCart.set(false);
    }
  }

  protected toggleCartCollapse(): void {
    this.isCartCollapsed.set(!this.isCartCollapsed());
    this.isRailTriggerHovering.set(false);
  }

  protected onRailTriggerEnter(): void {
    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(hover: hover) and (pointer: fine)').matches
    ) {
      return;
    }
    this.isRailTriggerHovering.set(true);
  }

  protected onRailTriggerLeave(): void {
    this.isRailTriggerHovering.set(false);
  }

  protected startQuickPayHold(): void {
    if (
      this.cart().length === 0 ||
      !this.canManageOrderActions() ||
      this.isReadOnly() ||
      this.isQuickPayHolding()
    ) {
      return;
    }

    this.isQuickPayHolding.set(true);
    this.quickPayProgress.set(0);
    this.quickPayHoldStartMs = performance.now();

    const tick = (now: number): void => {
      if (!this.isQuickPayHolding()) {
        return;
      }

      const start = this.quickPayHoldStartMs ?? now;
      const elapsed = now - start;
      const normalized = Math.min(1, elapsed / this.quickPayHoldDurationMs);
      const eased = 1 - Math.pow(1 - normalized, 2);
      this.quickPayProgress.set(Math.round(eased * 100));

      if (normalized >= 1) {
        this.finishQuickPayHold(true);
        return;
      }

      this.quickPayHoldRaf = requestAnimationFrame(tick);
    };

    this.quickPayHoldRaf = requestAnimationFrame(tick);
  }

  protected cancelQuickPayHold(): void {
    this.finishQuickPayHold(false);
  }

  protected openMobileCart(): void {
    this.isCartCollapsed.set(false);
    this.showMobileCart.set(true);
  }

  protected closeMobileCart(): void {
    this.showMobileCart.set(false);
  }

  protected onOrderSpecialInstructionsInput(event: Event): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.orderSpecialInstructions.set(value);
  }

  public ngOnInit(): void {
    const orderId = this.route.snapshot.paramMap.get('id');
    const offlineLocalId = this.route.snapshot.queryParamMap.get('offline');

    if (offlineLocalId) {
      this.isEditMode.set(true);
      this.isOfflineEditMode.set(true);
      this.offlineLocalId = offlineLocalId;
      this.offlineOrder.lockSyncForOfflineEdit(offlineLocalId);
      this.offlineEditSyncLockActive = true;
      this.loadOfflineOrderForEditing(offlineLocalId);
    } else if (orderId) {
      this.isEditMode.set(true);
      this.loadCustomers();
      this.catalogCache.load();
      this.loadOrderForEditing(orderId);
    } else {
      this.restoreSavedCart();
      this.loadCatalog();
    }

    this.loadBundlePromotions();

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
    });
  }

  public ngOnDestroy(): void {
    this.finishQuickPayHold(false);

    if (this.offlineEditSyncLockActive && this.offlineLocalId) {
      this.offlineOrder.unlockSyncForOfflineEdit(this.offlineLocalId);
      this.offlineEditSyncLockActive = false;
    }
  }

  private loadOrderForEditing(orderId: string): void {
    this.isLoading.set(true);

    this.orderService
      .getOrder(orderId)
      .pipe(
        switchMap((order) => {
          this.currentOrder.set(order);
          this.selectedCustomerId.set(order.customerId ?? null);
          this.orderSpecialInstructions.set(order.specialInstructions ?? '');

          if (order.status !== OrderStatusEnum.Pending) {
            this.router.navigateByUrl(AppRoutes.OrderDetailsById(order.id));
            return of(null);
          }

          this.populateCartFromOrder(order);
          return this.loadProductsForEdit();
        }),
      )
      .subscribe({
        next: () => {
          this.isLoading.set(false);
        },
        error: (err: Error) => {
          this.alertService.error(err.message || this.alertService.getLoadErrorMessage('order'));
          this.isLoading.set(false);
        },
      });
  }

  private loadOfflineOrderForEditing(localId: string): void {
    this.isLoading.set(true);

    this.offlineOrder.get(localId).then((pending) => {
      if (!pending) {
        this.alertService.error('Offline order not found.');
        this.isLoading.set(false);
        this.router.navigateByUrl(AppRoutes.OrdersList);
        return;
      }

      this.offlineOrderStatus.set(pending.command.status);
      this.cart.set([...pending.cartSnapshot]);
      this.selectedCustomerId.set(pending.command.customerId ?? null);
      this.orderSpecialInstructions.set(pending.command.specialInstructions ?? '');

      this.loadCatalog();
    });
  }

  private populateCartFromOrder(order: OrderDto): void {
    const bundleMetaByPromotionId = new Map(
      (order.bundlePromotions ?? []).map((bundle) => [bundle.promotionId, bundle]),
    );
    const groupedBundleItems = new Map<
      string,
      {
        productId: string;
        qty: number;
        price: number;
        addOns?: CartAddOnDto[];
        specialInstructions?: string | null;
      }[]
    >();
    const regularItems: CartItemDto[] = [];

    for (const item of order.items) {
      const expandedAddOns: CartAddOnDto[] = [];
      for (const ao of item.addOns ?? []) {
        for (let i = 0; i < ao.quantity; i++) {
          expandedAddOns.push({
            addOnId: ao.productId,
            name: '',
            price: ao.price ?? 0,
          });
        }
      }

      if (item.bundlePromotionId) {
        const current = groupedBundleItems.get(item.bundlePromotionId) ?? [];
        current.push({
          productId: item.productId,
          qty: item.quantity,
          price: item.price ?? 0,
          addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
          specialInstructions: item.specialInstructions ?? null,
        });
        groupedBundleItems.set(item.bundlePromotionId, current);
        continue;
      }

      regularItems.push({
        productId: item.productId,
        name: '',
        price: item.price ?? 0,
        qty: item.quantity,
        imageUrl: '',
        addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
        specialInstructions: item.specialInstructions,
      });
    }

    const bundleLines: CartItemDto[] = [];
    for (const [promotionId, items] of groupedBundleItems.entries()) {
      const bundleMeta = bundleMetaByPromotionId.get(promotionId);
      const bundleType =
        this.bundlePromotions().find((promo) => promo.id === promotionId)?.typeId ?? null;
      const bundleQty = Math.max(1, bundleMeta?.quantity ?? 1);
      const bundleItems: CartBundleItemDto[] = items
        .map((bundleItem) => ({
          productId: bundleItem.productId,
          name: '',
          price: bundleItem.price,
          qty:
            bundleType === PromotionTypeEnum.MixMatch
              ? Math.max(1, bundleItem.qty)
              : Math.max(1, Math.round(bundleItem.qty / bundleQty)),
          addOns: bundleItem.addOns,
          imageUrl: '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      bundleLines.push({
        productId: promotionId,
        name: bundleMeta?.promotionName ?? 'Bundle',
        price: bundleMeta?.unitPrice ?? 0,
        qty: bundleQty,
        imageUrl: '',
        specialInstructions:
          items.find((x) => (x.specialInstructions ?? '').trim().length > 0)?.specialInstructions ??
          null,
        bundlePromotionId: promotionId,
        bundlePromotionName: bundleMeta?.promotionName ?? 'Bundle',
        bundlePromotionTypeId: bundleType,
        bundleItems,
      });
    }

    this.cart.set([...regularItems, ...bundleLines]);
  }

  protected refreshProducts(): void {
    this.isRefreshing.set(true);

    this.catalogCache.refresh().then(() => {
      this.productsCache.set(this.catalogCache.products());
      this.customers.set(this.catalogCache.customers());
      this.applyFiltersToCache();
      this.loadBundlePromotions();
      this.isRefreshing.set(false);
    });
  }

  private loadCatalog(): void {
    this.isLoading.set(true);
    this.isLoadingCustomers.set(true);

    this.catalogCache.load().then(() => {
      this.productsCache.set(this.catalogCache.products());
      this.customers.set(this.catalogCache.customers());
      this.applyFiltersToCache();
      this.refreshCartImageUrls();
      this.isLoading.set(false);
      this.isLoadingCustomers.set(false);
    });
  }

  private loadCustomers(): void {
    this.isLoadingCustomers.set(true);

    this.customerService.getCustomers().subscribe({
      next: (result) => {
        this.customers.set(result);
        this.isLoadingCustomers.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message || this.alertService.getLoadErrorMessage('customers'));
        this.isLoadingCustomers.set(false);
      },
    });
  }

  private loadProductsForEdit() {
    const products$ = this.productService.getProducts({
      searchTerm: null,
      category: null,
      isAddOn: false,
      isActive: true,
    });

    const needsAddOns = this.cart().some(
      (c) =>
        (c.addOns?.length ?? 0) > 0 ||
        (c.bundleItems?.some((bi) => (bi.addOns?.length ?? 0) > 0) ?? false),
    );

    if (needsAddOns) {
      const allProducts$ = this.productService.getProducts({});

      return forkJoin([products$, allProducts$]).pipe(
        switchMap(([result, allProducts]) => {
          this.productsCache.set(result);
          this.applyFiltersToCache();
          this.enrichCartItems(allProducts);
          return of(void 0);
        }),
      );
    } else {
      return products$.pipe(
        switchMap((result) => {
          this.productsCache.set(result);
          this.applyFiltersToCache();
          this.enrichCartItems(result);
          return of(void 0);
        }),
      );
    }
  }

  private enrichCartItems(allProducts: ProductDto[]): void {
    const productById = new Map(allProducts.map((p) => [p.id, p]));
    const enrichedCart = this.cart().map((cartItem) => {
      const product = productById.get(cartItem.productId);
      const addOnGroups = this.catalogCache.getAddOnsForProduct(cartItem.productId);
      const addOnTypeById = new Map(
        addOnGroups.flatMap((group) =>
          group.options.map((option) => [option.id, group.type] as const),
        ),
      );
      const addOnOptionById = new Map(
        addOnGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)),
      );
      const enrichedAddOns = cartItem.addOns?.map((ao) => {
        const addOnOption = addOnOptionById.get(ao.addOnId);
        const addOnProduct = productById.get(ao.addOnId);
        const inferredType = ao.addOnType ?? addOnTypeById.get(ao.addOnId);
        return {
          ...ao,
          name: addOnOption?.name ?? addOnProduct?.name ?? ao.name ?? 'Add-on',
          price:
            addOnOption?.overridePrice ?? addOnOption?.price ?? addOnProduct?.price ?? ao.price,
          addOnType: inferredType,
        };
      });

      const enrichedBundleItems = cartItem.bundleItems?.map((bundleItem) => {
        const bundleProduct = productById.get(bundleItem.productId);
        const bundleAddOnGroups = this.catalogCache.getAddOnsForProduct(bundleItem.productId);
        const addOnTypeByBundleItemId = new Map(
          bundleAddOnGroups.flatMap((group) =>
            group.options.map((option) => [option.id, group.type] as const),
          ),
        );
        const addOnOptionByBundleItemId = new Map(
          bundleAddOnGroups.flatMap((group) =>
            group.options.map((option) => [option.id, option] as const),
          ),
        );

        const bundleAddOns = bundleItem.addOns?.map((ao) => {
          const addOnOption = addOnOptionByBundleItemId.get(ao.addOnId);
          const addOnProduct = productById.get(ao.addOnId);
          const inferredType = ao.addOnType ?? addOnTypeByBundleItemId.get(ao.addOnId);
          return {
            ...ao,
            name: addOnOption?.name ?? addOnProduct?.name ?? ao.name ?? 'Add-on',
            price:
              addOnOption?.overridePrice ?? addOnOption?.price ?? addOnProduct?.price ?? ao.price,
            addOnType: inferredType,
          };
        });

        return bundleProduct
          ? {
              ...bundleItem,
              name: bundleProduct.name,
              imageUrl: bundleProduct.imageUrl,
              addOns: bundleAddOns,
            }
          : { ...bundleItem, addOns: bundleAddOns };
      });

      if (!product) {
        return { ...cartItem, addOns: enrichedAddOns, bundleItems: enrichedBundleItems };
      }

      return {
        ...cartItem,
        name: product.name,
        imageUrl: product.imageUrl,
        addOns: enrichedAddOns,
        bundleItems: enrichedBundleItems,
      };
    });

    this.cart.set(enrichedCart);
    this.snapshotCart();
  }

  private snapshotCart(): void {
    this.originalCartSnapshot = JSON.stringify(this.getOrderSnapshotPayload());
  }

  private hasCartChanged(): boolean {
    if (!this.originalCartSnapshot) {
      return this.cart().length > 0;
    }

    return JSON.stringify(this.getOrderSnapshotPayload()) !== this.originalCartSnapshot;
  }

  private getOrderSnapshotPayload() {
    return {
      customerId: this.selectedCustomerId(),
      specialInstructions: this.orderSpecialInstructions().trim(),
      items: this.cart().map((c) => ({
        productId: c.productId,
        qty: c.qty,
        addOns: c.addOns?.map((ao) => ao.addOnId).sort() ?? [],
        bundleItems:
          c.bundleItems?.map((bundleItem) => ({
            productId: bundleItem.productId,
            qty: bundleItem.qty,
            addOns: bundleItem.addOns?.map((ao) => ao.addOnId).sort() ?? [],
          })) ?? [],
        specialInstructions: c.specialInstructions ?? null,
        bundlePromotionId: c.bundlePromotionId ?? null,
      })),
    };
  }

  protected addToCart(p: ProductDto): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    // If the product is an add-on-capable product, open the add-on selector
    this.addonSelector().open(p);
  }

  protected addBundlePromotionToCart(promo: PromotionListItemDto): void {
    if (!this.canManageOrderActions() || this.isReadOnly()) {
      return;
    }

    if (!this.isPromotionActiveInUserTimezone(promo)) {
      this.alertService.error('This bundle promotion is not active in your local timezone.');
      return;
    }

    const request$ =
      promo.typeId === PromotionTypeEnum.MixMatch
        ? this.promotionService
            .getMixMatchPromotion(promo.id)
            .pipe(
              switchMap((mixMatch) => of(this.toBundlePromotionSelectionFromMixMatch(mixMatch))),
            )
        : this.promotionService
            .getFixedBundle(promo.id)
            .pipe(
              switchMap((fixedBundle) =>
                of(this.toBundlePromotionSelectionFromFixedBundle(fixedBundle)),
              ),
            );

    request$.subscribe({
      next: (bundle) => this.openBundleSelector(bundle),
      error: (err: Error) =>
        this.alertService.error(
          err.message || this.alertService.getLoadErrorMessage('bundle promotion'),
        ),
    });
  }

  protected onAddonSelected(event: {
    product: ProductDto;
    addOns: CartAddOnDto[];
    quantity: number;
    specialInstructions?: string | null;
    editIndex?: number | null;
  }): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const { product, addOns, quantity, specialInstructions, editIndex } = event;
    const selectedBundle = this.pendingBundleSelection();

    if (selectedBundle && product.id === selectedBundle.id) {
      this.pendingBundleSelection.set(null);

      if (selectedBundle.typeId === PromotionTypeEnum.MixMatch) {
        const normalized = this.buildMixMatchSelectionFromAddonSelection(selectedBundle, addOns);
        this.upsertBundleCartLine(
          normalized,
          Math.max(1, quantity || 1),
          specialInstructions,
          editIndex,
        );
        return;
      }

      this.upsertBundleCartLine(
        selectedBundle,
        Math.max(1, quantity || 1),
        specialInstructions,
        editIndex,
      );
      return;
    }
    this.pendingBundleSelection.set(null);

    const lineQty = Math.max(1, quantity || 1);
    const updatedLine: CartItemDto = {
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: lineQty,
      imageUrl: product.imageUrl,
      addOns: addOns.length > 0 ? addOns : undefined,
      specialInstructions: specialInstructions || null,
    };

    if (editIndex !== null && editIndex !== undefined) {
      const current = this.cart();
      if (editIndex < 0 || editIndex >= current.length) {
        return;
      }

      this.cart.set(
        current.map((line, index) =>
          index === editIndex
            ? {
                ...updatedLine,
                bundlePromotionId: line.bundlePromotionId ?? null,
                bundlePromotionName: line.bundlePromotionName ?? null,
                bundlePromotionTypeId: line.bundlePromotionTypeId ?? null,
                bundleRequiredSelectionCount: line.bundleRequiredSelectionCount ?? null,
                bundleMaxSelectionPerOption: line.bundleMaxSelectionPerOption ?? null,
              }
            : line,
        ),
      );
      return;
    }

    // Only stack items without add-ons (plain products) and no special instructions
    if (addOns.length === 0 && !specialInstructions) {
      const existing = this.cart().find(
        (c) =>
          c.productId === product.id &&
          !c.addOns?.length &&
          !c.specialInstructions &&
          !c.bundlePromotionId,
      );

      if (existing) {
        this.cart.set(
          this.cart().map((c) =>
            c.productId === product.id &&
            !c.addOns?.length &&
            !c.specialInstructions &&
            !c.bundlePromotionId
              ? { ...c, qty: c.qty + lineQty }
              : c,
          ),
        );
        return;
      }
    }

    // Items with add-ons or special instructions always get their own cart line
    this.cart.set([...this.cart(), updatedLine]);
  }

  // Helper for template add-on price calculation
  protected readonly addOnPriceReducer = (sum: number, ao: CartAddOnDto) => sum + ao.price;
  protected getUnitAddOnTotal(item: CartItemDto): number {
    return (item.addOns ?? []).reduce(this.addOnPriceReducer, 0);
  }

  protected getUnitSubtotal(item: CartItemDto): number {
    return item.price + this.getUnitAddOnTotal(item);
  }

  protected getLineTotal(item: CartItemDto): number {
    if (item.bundleItems?.length) {
      return item.qty * item.price;
    }

    return item.qty * this.getUnitSubtotal(item);
  }

  protected getBundleChildTotalQuantity(
    bundleLine: CartItemDto,
    bundleItem: CartBundleItemDto,
  ): number {
    if (bundleLine.bundlePromotionTypeId === PromotionTypeEnum.MixMatch) {
      return Math.max(1, bundleItem.qty);
    }

    return Math.max(1, bundleLine.qty) * Math.max(1, bundleItem.qty);
  }

  protected getBundleChildDisplayRows(
    bundleLine: CartItemDto,
    bundleItem: CartBundleItemDto,
  ): number[] {
    const total = Math.max(1, bundleItem.qty);
    return Array.from({ length: total }, (_, index) => index);
  }

  protected getSortedBundleItems(item: CartItemDto): CartBundleItemDto[] {
    return [...(item.bundleItems ?? [])].sort((a, b) =>
      this.normalizeSortLabel(a.name).localeCompare(this.normalizeSortLabel(b.name)),
    );
  }

  protected getGroupedAddOns(item: CartItemDto): {
    addOnId: string;
    name: string;
    price: number;
    quantityPerUnit: number;
    lineTotal: number;
  }[] {
    const grouped = new Map<
      string,
      { addOnId: string; name: string; price: number; quantityPerUnit: number; sortOrder: number }
    >();
    const lineQty = Math.max(1, item.qty);

    for (const addOn of item.addOns ?? []) {
      const key = `${addOn.addOnId}::${addOn.price}`;
      const current = grouped.get(key);

      if (current) {
        current.quantityPerUnit += 1;
        continue;
      }

      grouped.set(key, {
        addOnId: addOn.addOnId,
        name: addOn.name,
        price: addOn.price,
        quantityPerUnit: 1,
        sortOrder: addOn.addOnType != null ? (ADD_ON_TYPE_ORDER[addOn.addOnType] ?? 99) : 99,
      });
    }

    return [...grouped.values()]
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          this.normalizeSortLabel(a.name).localeCompare(this.normalizeSortLabel(b.name)),
      )
      .map((entry) => ({
        addOnId: entry.addOnId,
        name: entry.name,
        price: entry.price,
        quantityPerUnit: entry.quantityPerUnit,
        lineTotal: entry.price * entry.quantityPerUnit * lineQty,
      }));
  }

  protected getGroupedBundleItemAddOns(bundleItem: CartBundleItemDto): {
    addOnId: string;
    name: string;
    quantityPerUnit: number;
  }[] {
    const grouped = new Map<
      string,
      { addOnId: string; name: string; quantityPerUnit: number; sortOrder: number }
    >();

    for (const addOn of bundleItem.addOns ?? []) {
      const current = grouped.get(addOn.addOnId);
      if (current) {
        current.quantityPerUnit += 1;
        continue;
      }

      grouped.set(addOn.addOnId, {
        addOnId: addOn.addOnId,
        name: addOn.name,
        quantityPerUnit: 1,
        sortOrder: addOn.addOnType != null ? (ADD_ON_TYPE_ORDER[addOn.addOnType] ?? 99) : 99,
      });
    }

    return [...grouped.values()]
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          this.normalizeSortLabel(a.name).localeCompare(this.normalizeSortLabel(b.name)),
      )
      .map((entry) => ({
        addOnId: entry.addOnId,
        name: entry.name,
        quantityPerUnit: entry.quantityPerUnit,
      }));
  }

  protected increment(productId: string, index: number): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const item = this.cart()[index];
    if (!item) {
      return;
    }

    if (item.bundleItems?.length && item.bundlePromotionId) {
      const bundleType =
        item.bundlePromotionTypeId ??
        this.bundlePromotions().find((promo) => promo.id === item.bundlePromotionId)?.typeId ??
        null;

      if (bundleType === PromotionTypeEnum.MixMatch) {
        this.openMixMatchBundleEditorForQuantity(index, Math.max(1, item.qty + 1));
        return;
      }
    }

    this.cart.set(this.cart().map((c, i) => (i === index ? { ...c, qty: c.qty + 1 } : c)));
  }

  protected decrement(productId: string, index: number): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const item = this.cart()[index];

    if (!item) {
      return;
    }

    if (item.qty <= 1) {
      this.cart.set(this.cart().filter((_, i) => i !== index));
      return;
    } else {
      if (item.bundleItems?.length && item.bundlePromotionId) {
        const bundleType =
          item.bundlePromotionTypeId ??
          this.bundlePromotions().find((promo) => promo.id === item.bundlePromotionId)?.typeId ??
          null;

        if (bundleType === PromotionTypeEnum.MixMatch) {
          this.openMixMatchBundleEditorForQuantity(index, Math.max(1, item.qty - 1));
          return;
        }
      }

      this.cart.set(this.cart().map((c, i) => (i === index ? { ...c, qty: c.qty - 1 } : c)));
    }
  }

  protected clearAll(): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    this.cart.set([]);
  }

  protected editCartItem(index: number): void {
    if (!this.canManageOrderActions() || this.isReadOnly()) {
      return;
    }

    const item = this.cart()[index];

    if (!item) {
      return;
    }

    if (item.bundleItems?.length && item.bundlePromotionId) {
      const existingType =
        this.bundlePromotions().find((x) => x.id === item.bundlePromotionId)?.typeId ??
        item.bundlePromotionTypeId ??
        PromotionTypeEnum.FixedBundle;
      if (existingType === PromotionTypeEnum.MixMatch) {
        this.promotionService.getMixMatchPromotion(item.bundlePromotionId).subscribe({
          next: (promo) => {
            const selectedCountByProductId = new Map<string, number>(
              (item.bundleItems ?? []).map((bundleItem) => [
                bundleItem.productId,
                Math.max(0, bundleItem.qty),
              ]),
            );

            const hydrated: BundlePromotionSelection = {
              id: promo.id,
              name: promo.name,
              typeId: PromotionTypeEnum.MixMatch,
              isActive: promo.isActive,
              imageUrl: promo.imageUrl,
              createdAt: promo.createdAt,
              createdBy: promo.createdBy,
              updatedAt: promo.updatedAt,
              updatedBy: promo.updatedBy,
              bundlePrice: promo.bundlePrice,
              requiredQuantity: promo.requiredQuantity,
              maxSelectionsPerOrder: promo.maxSelectionsPerOrder,
              items: promo.items.map((promoItem) => ({
                productId: promoItem.productId,
                quantity: selectedCountByProductId.get(promoItem.productId) ?? 0,
                addOns: promoItem.addOns.map((addOn) => ({
                  addOnProductId: addOn.addOnProductId,
                  quantity: addOn.quantity,
                })),
              })),
            };

            this.openBundleSelector(hydrated, {
              quantity: item.qty,
              specialInstructions: item.specialInstructions ?? null,
              editIndex: index,
            });
          },
          error: (err: Error) =>
            this.alertService.error(
              err.message || this.alertService.getLoadErrorMessage('bundle promotion'),
            ),
        });
        return;
      }

      const fixedBundle: BundlePromotionSelection = {
        id: item.bundlePromotionId,
        name: item.bundlePromotionName ?? item.name,
        typeId: PromotionTypeEnum.FixedBundle,
        isActive: true,
        imageUrl: item.imageUrl,
        bundlePrice: item.price,
        items: item.bundleItems.map((bundleItem) => ({
          productId: bundleItem.productId,
          quantity: bundleItem.qty,
          addOns: (bundleItem.addOns ?? []).map((addOn) => ({
            addOnProductId: addOn.addOnId,
            quantity: 1,
          })),
        })),
      };

      this.openBundleSelector(fixedBundle, {
        quantity: item.qty,
        specialInstructions: item.specialInstructions ?? null,
        editIndex: index,
      });
      return;
    }

    this.addonSelector().open(this.resolveProductForCartItem(item), {
      quantity: item.qty,
      addOns: item.addOns ?? [],
      specialInstructions: item.specialInstructions ?? null,
      editIndex: index,
    });
  }

  protected onCustomerSelected(customerId: string | null): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    this.selectedCustomerId.set(customerId);
  }

  protected getCustomerDisplayName(customer: CustomerDto): string {
    return `${customer.firstName} ${customer.lastName}`.trim();
  }

  protected getPaymentMethodLabel(method?: PaymentMethodEnum | null): string {
    if (method === PaymentMethodEnum.Cash) {
      return 'Cash';
    }

    if (method === PaymentMethodEnum.GCash) {
      return 'GCash';
    }

    return 'N/A';
  }

  protected getStatusVariant(
    status?: OrderStatusEnum | null,
  ): 'success' | 'error' | 'warning' | 'info' | 'default' {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'warning';
      case OrderStatusEnum.Completed:
        return 'success';
      case OrderStatusEnum.Cancelled:
        return 'default';
      case OrderStatusEnum.Refunded:
        return 'error';
      default:
        return 'info';
    }
  }

  protected getStatusLabel(status?: OrderStatusEnum | null): string {
    switch (status) {
      case OrderStatusEnum.Pending:
        return 'Pending';
      case OrderStatusEnum.Completed:
        return 'Completed';
      case OrderStatusEnum.Cancelled:
        return 'Cancelled';
      case OrderStatusEnum.Refunded:
        return 'Refunded';
      default:
        return 'Unknown';
    }
  }

  protected getOrderDateValue(order: OrderDto): string {
    return order.createdAt || order.updatedAt || '';
  }

  protected async downloadOrderImage(): Promise<void> {
    this.isDownloadingReceipt.set(true);
    try {
      await this.orderReceipt().generate();
    } finally {
      this.isDownloadingReceipt.set(false);
    }
  }

  protected openCreateCustomerModal(): void {
    if (!this.canCreateCustomerInOrder()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.createCustomerForm.reset({
      firstName: '',
      lastName: '',
    });
    this.createCustomerForm.markAsPristine();
    this.createCustomerForm.markAsUntouched();
    this.showCreateCustomerModal.set(true);
    this.createCustomerModalStackId = this.modalStack.push(() => this.closeCreateCustomerModal());
  }

  protected closeCreateCustomerModal(): void {
    if (this.isCreatingCustomer()) {
      return;
    }
    this.showCreateCustomerModal.set(false);
    this.removeStackId('createCustomer');
  }

  protected saveCustomerFromModal(): void {
    if (!this.canCreateCustomerInOrder()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (this.createCustomerForm.invalid || this.isCreatingCustomer()) {
      this.createCustomerForm.markAllAsTouched();
      return;
    }

    const firstName = this.createCustomerForm.controls.firstName.value.trim();
    const lastName = this.createCustomerForm.controls.lastName.value.trim();

    this.isCreatingCustomer.set(true);

    this.customerService
      .createCustomer({
        firstName,
        lastName,
      })
      .subscribe({
        next: (createdCustomer) => {
          this.customers.set([...this.customers(), createdCustomer]);
          this.selectedCustomerId.set(createdCustomer.id);
          this.showCreateCustomerModal.set(false);
          this.removeStackId('createCustomer');
          this.isCreatingCustomer.set(false);
          this.alertService.successCreated('Customer');
        },
        error: (err: Error) => {
          this.isCreatingCustomer.set(false);
          this.alertService.error(
            err.message || this.alertService.getCreateErrorMessage('customer'),
          );
        },
      });
  }

  protected cancel(): void {
    this.router.navigateByUrl(AppRoutes.OrdersList);
  }

  public canDeactivate(): boolean | Promise<boolean> {
    // No guard for completed/cancelled orders, after successful save, or unchanged cart
    if (
      this.skipGuard ||
      !this.authService.isAuthenticated() ||
      this.isReadOnly() ||
      !this.hasCartChanged()
    ) {
      return true;
    }

    this.showAbandonModal.set(true);
    this.abandonModalStackId = this.modalStack.push(() => this.cancelAbandon());

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected confirmAbandon(): void {
    this.showAbandonModal.set(false);
    this.removeStackId('abandon');

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(true);
      this.pendingDeactivateResolve = null;
    }
  }

  protected cancelAbandon(): void {
    this.showAbandonModal.set(false);
    this.removeStackId('abandon');

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(false);
      this.pendingDeactivateResolve = null;
    }
  }

  protected openCancelOrderModal(): void {
    if (!this.canManageOrderActions()) {
      this.alertService.errorUnauthorized();
      return;
    }

    this.cancelOrderNote.set(this.currentOrder()?.note ?? '');
    this.showCancelOrderNoteError.set(false);
    this.showCancelOrderModal.set(true);
    this.cancelOrderModalStackId = this.modalStack.push(() => this.dismissCancelOrder());
  }

  protected onCancelOrderNoteInput(event: Event): void {
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.cancelOrderNote.set(value);
    if (this.showCancelOrderNoteError() && value.trim()) {
      this.showCancelOrderNoteError.set(false);
    }
  }

  protected confirmCancelOrder(): void {
    if (!this.canManageOrderActions()) {
      this.alertService.errorUnauthorized();
      return;
    }

    const order = this.currentOrder();
    if (!order) {
      return;
    }

    const note = this.cancelOrderNote().trim();
    if (this.isCompleted() && !note) {
      this.showCancelOrderNoteError.set(true);
      this.alertService.error('Refund note is required.');
      return;
    }

    this.showCancelOrderModal.set(false);
    this.removeStackId('cancelOrder');

    this.orderService.voidOrder(order.id, note || null).subscribe({
      next: () => {
        this.skipGuard = true;

        const message =
          order.status === OrderStatusEnum.Completed
            ? 'Order has been refunded'
            : 'Order has been cancelled';

        this.alertService.success(message);
        this.router.navigateByUrl(AppRoutes.OrdersList);
      },
      error: (err: Error) => {
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('order'));
      },
    });
  }

  protected dismissCancelOrder(): void {
    this.showCancelOrderModal.set(false);
    this.showCancelOrderNoteError.set(false);
    this.removeStackId('cancelOrder');
  }

  protected openDiscardOrderModal(): void {
    this.showDiscardOrderModal.set(true);
    this.discardOrderModalStackId = this.modalStack.push(() => this.dismissDiscardOrder());
  }

  protected confirmDiscardOrder(): void {
    if (!this.offlineLocalId) {
      return;
    }

    this.showDiscardOrderModal.set(false);
    this.removeStackId('discardOrder');

    this.offlineOrder.remove(this.offlineLocalId).then(() => {
      this.skipGuard = true;
      this.alertService.success(`Order ${this.offlineLocalId} discarded.`);
      this.router.navigateByUrl(AppRoutes.OrdersList);
    });
  }

  protected dismissDiscardOrder(): void {
    this.showDiscardOrderModal.set(false);
    this.removeStackId('discardOrder');
  }

  private removeStackId(
    modal: 'abandon' | 'cancelOrder' | 'discardOrder' | 'createCustomer',
  ): void {
    const key = `${modal}ModalStackId` as const;
    const id = this[key];

    if (id !== null) {
      this.modalStack.remove(id);
      this[key] = null;
    }
  }

  protected checkout(): void {
    if (!this.canManageOrderActions()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (this.cart().length === 0) {
      return;
    }

    this.checkoutModal().triggerOpen();
  }

  private finishQuickPayHold(shouldCheckout: boolean): void {
    if (this.quickPayHoldRaf !== null) {
      cancelAnimationFrame(this.quickPayHoldRaf);
      this.quickPayHoldRaf = null;
    }
    this.quickPayHoldStartMs = null;

    const reachedConfirm = this.quickPayProgress() >= 100 && shouldCheckout;

    this.isQuickPayHolding.set(false);
    this.quickPayProgress.set(0);

    if (reachedConfirm) {
      this.checkout();
    }
  }

  protected onOrderSaved(): void {
    if (!this.canManageOrderActions()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (this.cart().length === 0) {
      return;
    }

    if (this.isSavingOrder()) {
      return;
    }

    if (this.isOfflineEditMode()) {
      this.saveOfflineOrder(OrderStatusEnum.Pending);
    } else if (this.isEditMode()) {
      this.updateExistingOrder(OrderStatusEnum.Pending);
    } else {
      this.createNewOrder(OrderStatusEnum.Pending);
    }
  }

  protected onOrderConfirmed(event: {
    paymentMethod: PaymentMethodEnum;
    amountReceived?: number;
    changeAmount?: number;
    tips?: number;
  }): void {
    if (!this.canManageOrderActions()) {
      this.alertService.errorUnauthorized();
      return;
    }

    if (this.isOfflineEditMode()) {
      this.saveOfflineOrder(OrderStatusEnum.Completed, event);
    } else if (this.isEditMode()) {
      this.updateExistingOrder(OrderStatusEnum.Completed, event);
    } else {
      this.createNewOrder(OrderStatusEnum.Completed, event);
    }
  }

  private createNewOrder(
    status: OrderStatusEnum,
    event?: {
      paymentMethod: PaymentMethodEnum;
      amountReceived?: number;
      changeAmount?: number;
      tips?: number;
    },
  ): void {
    if (this.isSavingOrder()) {
      return;
    }

    this.isSavingOrder.set(true);

    const command: CreateOrderCommand = {
      customerId: this.selectedCustomerId(),
      items: this.buildOrderItemsFromCart(),
      bundlePromotions: this.buildBundlePromotionsFromCart(),
      specialInstructions: this.orderSpecialInstructions().trim() || null,
      status,
      ...(event && {
        paymentMethod: event.paymentMethod,
        amountReceived: event.amountReceived ?? null,
        changeAmount: event.changeAmount ?? null,
        tips: event.tips ?? null,
      }),
    };

    if (!this.connectivity.isOnline()) {
      this.queueOfflineOrder(command);
      return;
    }

    this.orderService.createOrder(command).subscribe({
      next: () => {
        this.isSavingOrder.set(false);
        this.skipGuard = true;
        this.cartPersistence.clear();
        this.router.navigateByUrl(AppRoutes.OrdersList);
      },
      error: (err) => {
        this.isSavingOrder.set(false);
        this.alertService.error(err.message || this.alertService.getCreateErrorMessage('order'));
      },
    });
  }

  private queueOfflineOrder(command: CreateOrderCommand): void {
    this.offlineOrder
      .queue(command, this.cart(), this.selectedCustomerName())
      .then((localId) => {
        this.isSavingOrder.set(false);
        this.skipGuard = true;
        this.cartPersistence.clear();
        this.alertService.info(
          `Order ${localId} saved offline. It will sync when you're back online.`,
        );
        this.router.navigateByUrl(AppRoutes.OrdersList);
      })
      .catch(() => {
        this.isSavingOrder.set(false);
        this.alertService.error('Failed to save order offline.');
      });
  }

  private saveOfflineOrder(
    status: OrderStatusEnum,
    event?: {
      paymentMethod: PaymentMethodEnum;
      amountReceived?: number;
      changeAmount?: number;
      tips?: number;
    },
  ): void {
    if (!this.offlineLocalId || this.isSavingOrder()) {
      return;
    }

    this.isSavingOrder.set(true);

    const command: CreateOrderCommand = {
      customerId: this.selectedCustomerId(),
      items: this.buildOrderItemsFromCart(),
      bundlePromotions: this.buildBundlePromotionsFromCart(),
      specialInstructions: this.orderSpecialInstructions().trim() || null,
      status,
      ...(event && {
        paymentMethod: event.paymentMethod,
        amountReceived: event.amountReceived ?? null,
        changeAmount: event.changeAmount ?? null,
        tips: event.tips ?? null,
      }),
    };

    this.offlineOrder
      .update(this.offlineLocalId, command, this.cart(), this.selectedCustomerName())
      .then(() => {
        this.isSavingOrder.set(false);
        this.skipGuard = true;
        this.alertService.info(`Order ${this.offlineLocalId} updated offline.`);
        this.router.navigateByUrl(AppRoutes.OrdersList);
      })
      .catch(() => {
        this.isSavingOrder.set(false);
        this.alertService.error('Failed to update offline order.');
      });
  }

  private updateExistingOrder(
    status: OrderStatusEnum,
    event?: {
      paymentMethod: PaymentMethodEnum;
      amountReceived?: number;
      changeAmount?: number;
      tips?: number;
    },
  ): void {
    const order = this.currentOrder();
    if (!order) return;

    if (this.isSavingOrder()) {
      return;
    }

    this.isSavingOrder.set(true);

    const command: UpdateOrderCommand = {
      id: order.id,
      customerId: this.selectedCustomerId(),
      items: this.buildOrderItemsFromCart(),
      bundlePromotions: this.buildBundlePromotionsFromCart(),
      specialInstructions: this.orderSpecialInstructions().trim() || null,
      status,
      ...(event && {
        paymentMethod: event.paymentMethod,
        amountReceived: event.amountReceived ?? null,
        changeAmount: event.changeAmount ?? null,
        tips: event.tips ?? null,
      }),
    };

    this.orderService.updateOrder(command).subscribe({
      next: () => {
        this.isSavingOrder.set(false);
        this.skipGuard = true;
        this.cartPersistence.clear();
        this.router.navigateByUrl(AppRoutes.OrdersList);
      },
      error: (err) => {
        this.isSavingOrder.set(false);
        const message = err?.message || this.alertService.getUpdateErrorMessage('order');
        this.alertService.error(message);
        if (
          typeof message === 'string' &&
          message.toLowerCase().includes('order is already') &&
          message.toLowerCase().includes('cannot be updated')
        ) {
          this.skipGuard = true;
          this.router.navigateByUrl(AppRoutes.OrdersList);
        }
      },
    });
  }

  private restoreSavedCart(): void {
    this.cartPersistence.load().then((saved) => {
      if (saved && saved.items.length > 0) {
        this.cart.set(saved.items);
        this.selectedCustomerId.set(saved.customerId);
        this.orderSpecialInstructions.set(saved.specialInstructions);
      }

      // Enable auto-save only after restore completes to avoid overwriting with empty cart
      this.cartPersistenceReady = true;
      this.cdr.detectChanges();

      // Re-resolve cart image URLs from catalog cache (blob URLs are session-specific)
      this.refreshCartImageUrls();
    });
  }

  private refreshCartImageUrls(): void {
    const products = this.catalogCache.products();

    if (products.length === 0 || this.cart().length === 0) {
      return;
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    const enrichAddOnsForProduct = (
      ownerProductId: string,
      addOns?: CartAddOnDto[],
    ): CartAddOnDto[] | undefined => {
      if (!addOns?.length) {
        return addOns;
      }

      const addOnGroups = this.catalogCache.getAddOnsForProduct(ownerProductId);
      const addOnTypeById = new Map(
        addOnGroups.flatMap((group) =>
          group.options.map((option) => [option.id, group.type] as const),
        ),
      );
      const addOnOptionById = new Map(
        addOnGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)),
      );

      return addOns.map((addOn) => {
        const option = addOnOptionById.get(addOn.addOnId);
        const product = productMap.get(addOn.addOnId);
        return {
          ...addOn,
          name: option?.name ?? product?.name ?? addOn.name ?? 'Add-on',
          price: option?.overridePrice ?? option?.price ?? product?.price ?? addOn.price,
          addOnType: addOn.addOnType ?? addOnTypeById.get(addOn.addOnId),
        };
      });
    };

    const updated = this.cart().map((item) => {
      const product = productMap.get(item.productId);
      const bundleItems = item.bundleItems
        ?.map((bundleItem) => {
          const bundleProduct = productMap.get(bundleItem.productId);
          const enrichedAddOns = enrichAddOnsForProduct(bundleItem.productId, bundleItem.addOns);
          return bundleProduct
            ? { ...bundleItem, imageUrl: bundleProduct.imageUrl, addOns: enrichedAddOns }
            : { ...bundleItem, addOns: enrichedAddOns };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const enrichedItemAddOns = enrichAddOnsForProduct(item.productId, item.addOns);

      return product
        ? { ...item, imageUrl: product.imageUrl, addOns: enrichedItemAddOns, bundleItems }
        : { ...item, addOns: enrichedItemAddOns, bundleItems };
    });

    this.cart.set(updated);
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;
    const activeTab = this.activeSubCategoryTab();

    let items = [...this.productsCache()];

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(lowerSearchTerm));
    }

    items = items.filter((p) => p.subCategory === activeTab);

    this.products.set(items);
  }

  private loadBundlePromotions(): void {
    this.isLoadingPromotions.set(true);
    this.catalogCache
      .load()
      .then(() => {
        this.bundlePromotions.set(this.catalogCache.bundlePromotions());
      })
      .finally(() => this.isLoadingPromotions.set(false));
  }

  private isPromotionActiveInUserTimezone(promo: PromotionListItemDto): boolean {
    if (!promo.isActive) {
      return false;
    }

    const nowLocal = new Date();
    const nowLocalDate = this.toLocalDateNumber(nowLocal);

    const startLocal = promo.startDate ? new Date(promo.startDate) : null;
    if (startLocal && Number.isNaN(startLocal.getTime())) {
      return false;
    }
    const startLocalDate = startLocal ? this.toLocalDateNumber(startLocal) : null;
    if (startLocalDate !== null && nowLocalDate < startLocalDate) {
      return false;
    }

    const endLocal = promo.endDate ? new Date(promo.endDate) : null;
    if (endLocal && Number.isNaN(endLocal.getTime())) {
      return false;
    }
    const endLocalDate = endLocal ? this.toLocalDateNumber(endLocal) : null;
    if (endLocalDate !== null && nowLocalDate > endLocalDate) {
      return false;
    }

    return true;
  }

  private toLocalDateNumber(value: Date): number {
    if (Number.isNaN(value.getTime())) {
      return -1;
    }

    return value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate();
  }

  private groupAddOns(addOns?: CartAddOnDto[]): OrderItemRequestDto[] {
    if (!addOns || addOns.length === 0) {
      return [];
    }

    const grouped = new Map<string, number>();

    for (const ao of addOns) {
      grouped.set(ao.addOnId, (grouped.get(ao.addOnId) ?? 0) + 1);
    }

    return Array.from(grouped.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
      addOns: [],
      bundlePromotionId: null,
    }));
  }

  private buildOrderItemsFromCart(): OrderItemRequestDto[] {
    const items: OrderItemRequestDto[] = [];
    const promotionTypeById = new Map(
      this.bundlePromotions().map((promo) => [promo.id, promo.typeId]),
    );

    for (const line of this.cart()) {
      if (line.bundleItems?.length) {
        const promotionType =
          line.bundlePromotionTypeId ??
          (line.bundlePromotionId ? promotionTypeById.get(line.bundlePromotionId) : null) ??
          null;

        for (const bundleItem of line.bundleItems) {
          items.push({
            productId: bundleItem.productId,
            quantity:
              promotionType === PromotionTypeEnum.MixMatch
                ? Math.max(1, bundleItem.qty)
                : Math.max(1, line.qty) * Math.max(1, bundleItem.qty),
            addOns: this.groupAddOns(bundleItem.addOns),
            specialInstructions: line.specialInstructions || null,
            bundlePromotionId: line.bundlePromotionId ?? null,
          });
        }

        continue;
      }

      items.push({
        productId: line.productId,
        quantity: line.qty,
        addOns: this.groupAddOns(line.addOns),
        specialInstructions: line.specialInstructions || null,
        bundlePromotionId: null,
      });
    }

    return items;
  }

  private buildBundlePromotionsFromCart(): { promotionId: string; quantity: number }[] {
    const grouped = new Map<string, { promotionId: string; quantity: number }>();

    for (const line of this.cart()) {
      if (!line.bundlePromotionId || !(line.bundleItems?.length ?? 0)) {
        continue;
      }

      const current = grouped.get(line.bundlePromotionId);
      if (current) {
        current.quantity += Math.max(1, line.qty);
        continue;
      }

      grouped.set(line.bundlePromotionId, {
        promotionId: line.bundlePromotionId,
        quantity: Math.max(1, line.qty),
      });
    }

    return [...grouped.values()];
  }

  private resolveProductForCartItem(item: CartItemDto): ProductDto {
    const product =
      this.catalogCache.products().find((p) => p.id === item.productId) ??
      this.productsCache().find((p) => p.id === item.productId) ??
      this.products().find((p) => p.id === item.productId);

    if (product) {
      return product;
    }

    return {
      id: item.productId,
      name: item.name,
      code: item.productId,
      description: null,
      price: item.price,
      category: ProductCategoryEnum.Other,
      subCategory: null,
      isAddOn: false,
      isActive: true,
      createdAt: '',
      createdBy: '',
      updatedAt: null,
      updatedBy: null,
      imageUrl: item.imageUrl,
      priceHistory: [],
      addOnCount: 0,
      overridePrice: null,
    };
  }

  private openBundleSelector(
    bundle: BundlePromotionSelection,
    options?: { quantity?: number; specialInstructions?: string | null; editIndex?: number | null },
  ): void {
    const hasAvailableItems = this.buildBundleCartItems(bundle).length > 0;
    if (!hasAvailableItems) {
      this.alertService.error('Bundle products are unavailable in the current catalog.');
      return;
    }

    this.pendingBundleSelection.set(bundle);
    const customGroups =
      bundle.typeId === PromotionTypeEnum.MixMatch
        ? this.buildMixMatchOptionGroups(bundle)
        : undefined;
    const preselectedAddOns =
      bundle.typeId === PromotionTypeEnum.MixMatch
        ? this.buildPreselectedMixMatchOptions(bundle)
        : undefined;

    this.addonSelector().open(
      {
        id: bundle.id,
        name: bundle.name,
        code: bundle.id,
        description: null,
        price: bundle.bundlePrice,
        category: ProductCategoryEnum.Other,
        subCategory: null,
        isAddOn: false,
        isActive: bundle.isActive,
        createdAt: bundle.createdAt ?? '',
        createdBy: bundle.createdBy ?? '',
        updatedAt: bundle.updatedAt ?? null,
        updatedBy: bundle.updatedBy ?? null,
        imageUrl: bundle.imageUrl ?? null,
        priceHistory: [],
        addOnCount: 0,
        overridePrice: null,
      },
      {
        quantity: options?.quantity ?? 1,
        addOns: preselectedAddOns,
        specialInstructions: options?.specialInstructions ?? null,
        editIndex: options?.editIndex ?? null,
        customGroups,
        requiredSelectionCount:
          bundle.typeId === PromotionTypeEnum.MixMatch
            ? Math.max(1, bundle.requiredQuantity ?? 1)
            : null,
        scaleRequiredSelectionByQuantity: bundle.typeId === PromotionTypeEnum.MixMatch,
        maxSelectionPerOption:
          bundle.typeId === PromotionTypeEnum.MixMatch
            ? (bundle.maxSelectionsPerOrder ?? null)
            : null,
        subtitleText:
          bundle.typeId === PromotionTypeEnum.MixMatch
            ? 'Select mix & match items'
            : 'Customize your order',
      },
    );
  }

  private buildPreselectedMixMatchOptions(bundle: BundlePromotionSelection): CartAddOnDto[] {
    const selections: CartAddOnDto[] = [];
    const optionById = new Map(
      this.buildMixMatchOptionGroups(bundle)[0]?.options.map((x) => [x.id, x]) ?? [],
    );

    for (const item of bundle.items) {
      const qty = Math.max(0, item.quantity ?? 0);
      if (qty <= 0) {
        continue;
      }

      const option = optionById.get(item.productId);
      for (let i = 0; i < qty; i++) {
        selections.push({
          addOnId: item.productId,
          name: option?.name ?? 'Selected item',
          price: 0,
          addOnType: AddOnTypeEnum.Extra,
        });
      }
    }

    return selections;
  }

  private buildMixMatchOptionGroups(bundle: BundlePromotionSelection): AddOnGroupDto[] {
    const catalogProducts = this.catalogCache.products();
    const allProducts = this.productsCache().length > 0 ? this.productsCache() : catalogProducts;
    const productById = new Map(allProducts.map((x) => [x.id, x]));

    const options = bundle.items
      .map((item) => productById.get(item.productId))
      .filter((x): x is ProductDto => !!x)
      .map((product) => ({
        ...product,
        price: 0,
        overridePrice: 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return [
      {
        type: AddOnTypeEnum.Extra,
        displayName: 'Items',
        options,
      },
    ];
  }

  private buildMixMatchSelectionFromAddonSelection(
    bundle: BundlePromotionSelection,
    selectedOptions: CartAddOnDto[],
  ): BundlePromotionSelection {
    const selectedCountByProductId = new Map<string, number>();
    for (const option of selectedOptions) {
      selectedCountByProductId.set(
        option.addOnId,
        (selectedCountByProductId.get(option.addOnId) ?? 0) + 1,
      );
    }

    return {
      ...bundle,
      items: bundle.items
        .map((item) => ({
          ...item,
          quantity: selectedCountByProductId.get(item.productId) ?? 0,
        }))
        .filter((item) => (item.quantity ?? 0) > 0),
    };
  }

  private upsertBundleCartLine(
    bundle: BundlePromotionSelection,
    quantity: number,
    specialInstructions?: string | null,
    editIndex?: number | null,
  ): void {
    const bundleItems = this.buildBundleCartItems(bundle);
    if (bundleItems.length === 0) {
      this.alertService.error('Bundle products are unavailable in the current catalog.');
      return;
    }

    const line: CartItemDto = {
      productId: bundle.id,
      name: bundle.name,
      price: bundle.bundlePrice,
      qty: Math.max(1, quantity || 1),
      imageUrl: bundle.imageUrl ?? null,
      addOns: undefined,
      specialInstructions: specialInstructions || null,
      bundlePromotionId: bundle.id,
      bundlePromotionName: bundle.name,
      bundlePromotionTypeId: bundle.typeId,
      bundleRequiredSelectionCount:
        bundle.typeId === PromotionTypeEnum.MixMatch ? (bundle.requiredQuantity ?? null) : null,
      bundleMaxSelectionPerOption:
        bundle.typeId === PromotionTypeEnum.MixMatch
          ? (bundle.maxSelectionsPerOrder ?? null)
          : null,
      bundleItems,
    };

    if (editIndex !== null && editIndex !== undefined) {
      const current = this.cart();
      if (editIndex < 0 || editIndex >= current.length) {
        return;
      }

      this.cart.set(current.map((item, index) => (index === editIndex ? line : item)));
      return;
    }

    const existingIndex = this.cart().findIndex(
      (item) => item.bundlePromotionId === bundle.id && (item.bundleItems?.length ?? 0) > 0,
    );

    if (existingIndex < 0) {
      this.cart.set([...this.cart(), line]);
      return;
    }

    const current = this.cart();
    const existing = current[existingIndex];

    const mergedBundleItems =
      bundle.typeId === PromotionTypeEnum.MixMatch
        ? (() => {
            const mergedByProductId = new Map<string, CartBundleItemDto>();
            for (const item of existing.bundleItems ?? []) {
              mergedByProductId.set(item.productId, { ...item, qty: Math.max(1, item.qty) });
            }

            for (const item of line.bundleItems ?? []) {
              const currentItem = mergedByProductId.get(item.productId);
              if (currentItem) {
                currentItem.qty += Math.max(1, item.qty);
              } else {
                mergedByProductId.set(item.productId, { ...item, qty: Math.max(1, item.qty) });
              }
            }

            return [...mergedByProductId.values()].sort((a, b) => a.name.localeCompare(b.name));
          })()
        : (existing.bundleItems ?? line.bundleItems);

    const mergedLine: CartItemDto = {
      ...existing,
      qty: Math.max(1, existing.qty) + Math.max(1, line.qty),
      bundlePromotionTypeId: line.bundlePromotionTypeId ?? existing.bundlePromotionTypeId ?? null,
      bundleRequiredSelectionCount:
        line.bundleRequiredSelectionCount ?? existing.bundleRequiredSelectionCount ?? null,
      bundleMaxSelectionPerOption:
        line.bundleMaxSelectionPerOption ?? existing.bundleMaxSelectionPerOption ?? null,
      specialInstructions: existing.specialInstructions || line.specialInstructions || null,
      bundleItems: mergedBundleItems,
    };

    this.cart.set(current.map((item, index) => (index === existingIndex ? mergedLine : item)));
  }

  private buildBundleCartItems(bundle: BundlePromotionSelection): CartBundleItemDto[] {
    const catalogProducts = this.catalogCache.products();
    const allProducts = this.productsCache().length > 0 ? this.productsCache() : catalogProducts;
    const productById = new Map(allProducts.map((p) => [p.id, p]));
    const bundleItems: CartBundleItemDto[] = [];

    for (const bundleItem of bundle.items) {
      const product = productById.get(bundleItem.productId);
      if (!product) {
        continue;
      }

      const addOnGroups = this.catalogCache.getAddOnsForProduct(product.id);
      const addOnTypeById = new Map(
        addOnGroups.flatMap((group) =>
          group.options.map((option) => [option.id, group.type] as const),
        ),
      );
      const addOnOptionById = new Map(
        addOnGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)),
      );

      const expandedAddOns: CartAddOnDto[] = [];
      for (const addOn of bundleItem.addOns ?? []) {
        const addOnOption = addOnOptionById.get(addOn.addOnProductId);
        const addOnProduct = productById.get(addOn.addOnProductId);
        const qty = Math.max(1, addOn.quantity || 1);

        for (let i = 0; i < qty; i++) {
          expandedAddOns.push({
            addOnId: addOn.addOnProductId,
            name: addOnOption?.name ?? addOnProduct?.name ?? 'Add-on',
            price: addOnOption?.overridePrice ?? addOnOption?.price ?? addOnProduct?.price ?? 0,
            addOnType: addOnTypeById.get(addOn.addOnProductId),
          });
        }
      }

      bundleItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        qty: Math.max(1, bundleItem.quantity || 1),
        imageUrl: product.imageUrl,
        addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
      });
    }

    return [...bundleItems].sort((a, b) => a.name.localeCompare(b.name));
  }

  private normalizeSortLabel(value: string): string {
    return value
      .replace(/^\s*\d+\s*x\s+/i, '')
      .trim()
      .toLowerCase();
  }

  private openMixMatchBundleEditorForQuantity(index: number, quantity: number): void {
    const item = this.cart()[index];
    if (!item || !item.bundlePromotionId) {
      return;
    }

    this.promotionService.getMixMatchPromotion(item.bundlePromotionId).subscribe({
      next: (promo) => {
        const selectedCountByProductId = new Map<string, number>(
          (item.bundleItems ?? []).map((bundleItem) => [
            bundleItem.productId,
            Math.max(0, bundleItem.qty),
          ]),
        );

        const hydrated: BundlePromotionSelection = {
          id: promo.id,
          name: promo.name,
          typeId: PromotionTypeEnum.MixMatch,
          isActive: promo.isActive,
          imageUrl: promo.imageUrl,
          createdAt: promo.createdAt,
          createdBy: promo.createdBy,
          updatedAt: promo.updatedAt,
          updatedBy: promo.updatedBy,
          bundlePrice: promo.bundlePrice,
          requiredQuantity: promo.requiredQuantity,
          maxSelectionsPerOrder: promo.maxSelectionsPerOrder,
          items: promo.items
            .map((promoItem) => ({
              productId: promoItem.productId,
              quantity: selectedCountByProductId.get(promoItem.productId) ?? 0,
              addOns: promoItem.addOns.map((addOn) => ({
                addOnProductId: addOn.addOnProductId,
                quantity: addOn.quantity,
              })),
            }))
            .sort((a, b) => {
              const aName =
                this.catalogCache.products().find((p) => p.id === a.productId)?.name ?? '';
              const bName =
                this.catalogCache.products().find((p) => p.id === b.productId)?.name ?? '';
              return aName.localeCompare(bName);
            }),
        };

        this.openBundleSelector(hydrated, {
          quantity,
          specialInstructions: item.specialInstructions ?? null,
          editIndex: index,
        });
      },
      error: (err: Error) =>
        this.alertService.error(
          err.message || this.alertService.getLoadErrorMessage('bundle promotion'),
        ),
    });
  }

  private toBundlePromotionSelectionFromFixedBundle(
    bundle: FixedBundlePromotionDto,
  ): BundlePromotionSelection {
    return {
      id: bundle.id,
      name: bundle.name,
      typeId: PromotionTypeEnum.FixedBundle,
      isActive: bundle.isActive,
      imageUrl: bundle.imageUrl,
      createdAt: bundle.createdAt,
      createdBy: bundle.createdBy,
      updatedAt: bundle.updatedAt,
      updatedBy: bundle.updatedBy,
      bundlePrice: bundle.bundlePrice,
      items: bundle.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        addOns: item.addOns.map((addOn) => ({
          addOnProductId: addOn.addOnProductId,
          quantity: addOn.quantity,
        })),
      })),
    };
  }

  private toBundlePromotionSelectionFromMixMatch(
    promo: MixMatchPromotionDto,
  ): BundlePromotionSelection {
    return {
      id: promo.id,
      name: promo.name,
      typeId: PromotionTypeEnum.MixMatch,
      isActive: promo.isActive,
      imageUrl: promo.imageUrl,
      createdAt: promo.createdAt,
      createdBy: promo.createdBy,
      updatedAt: promo.updatedAt,
      updatedBy: promo.updatedBy,
      bundlePrice: promo.bundlePrice,
      requiredQuantity: promo.requiredQuantity,
      maxSelectionsPerOrder: promo.maxSelectionsPerOrder,
      items: promo.items.map((item) => ({
        productId: item.productId,
        quantity: 0,
        addOns: item.addOns.map((addOn) => ({
          addOnProductId: addOn.addOnProductId,
          quantity: addOn.quantity,
        })),
      })),
    };
  }
}
