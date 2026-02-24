import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
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
} from '@core/services';
import type { CustomerDropdownOption, ReceiptData } from '@shared/components';
import {
  AddonSelectorComponent,
  AvatarComponent,
  BadgeComponent,
  CustomerDropdown,
  Icon,
  OrderReceiptComponent,
  PullToRefreshComponent,
} from '@shared/components';
import {
  CartAddOnDto,
  CartItemDto,
  CreateOrderCommand,
  CustomerDto,
  OrderDto,
  OrderItemRequestDto,
  OrderStatusEnum,
  PaymentMethodEnum,
  ProductCategoryEnum,
  ProductDto,
  ProductSubCategoryEnum,
  UpdateOrderCommand,
} from '@shared/models';
import { SortAddOnsPipe } from '@shared/pipes';
import { debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { CheckoutModal } from '../checkout-modal/checkout-modal';

@Component({
  selector: 'app-order-editor',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    Icon,
    CheckoutModal,
    CustomerDropdown,
    AddonSelectorComponent,
    AvatarComponent,
    BadgeComponent,
    PullToRefreshComponent,
    OrderReceiptComponent,
    SortAddOnsPipe,
  ],
  templateUrl: './order-editor.html',
})
export class OrderEditor implements OnInit {
  private readonly checkoutModal = viewChild.required(CheckoutModal);
  private readonly addonSelector = viewChild.required(AddonSelectorComponent);
  private readonly orderReceipt = viewChild.required(OrderReceiptComponent);
  private readonly productService = inject(ProductService);
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
  private summaryModalStackId: number | null = null;
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
  protected readonly showOrderSummaryModal = signal(false);
  protected readonly showCreateCustomerModal = signal(false);
  protected readonly isCreatingCustomer = signal(false);
  protected readonly isSavingOrder = signal(false);
  protected readonly showMobileCart = signal(false);
  protected readonly cartDragY = signal(0);
  protected readonly isCartDragging = signal(false);
  private cartDragStartY = 0;
  protected readonly isRefreshing = signal(false);
  protected readonly isDownloadingReceipt = signal(false);

  protected readonly createCustomerForm = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });
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
  protected readonly selectedCustomerId = signal<string | null>(null);
  protected readonly isLoadingCustomers = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly isEditMode = signal(false);
  protected readonly currentOrder = signal<OrderDto | null>(null);

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

  protected readonly isReadOnly = computed(
    () => this.isCompleted() || this.isCancelled() || this.isRefunded(),
  );
  protected readonly showPaymentSummary = computed(() => {
    const order = this.currentOrder();
    if (!order) {
      return false;
    }

    const isSettledOrder =
      order.status === OrderStatusEnum.Completed || order.status === OrderStatusEnum.Refunded;
    const hasPaymentData =
      order.paymentMethod != null ||
      order.amountReceived != null ||
      order.changeAmount != null ||
      order.tips != null;

    return isSettledOrder && hasPaymentData;
  });
  protected readonly paymentTipsAmount = computed(() => this.currentOrder()?.tips ?? 0);
  protected readonly paymentChangeAmount = computed(() => this.currentOrder()?.changeAmount ?? 0);
  protected readonly paymentOrderTotal = computed(
    () => this.currentOrder()?.totalAmount ?? this.totalPrice(),
  );
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
    return {
      orderNumber: order?.orderNumber ?? null,
      customerName: this.selectedCustomerName(),
      date: order
        ? new Date(order.updatedAt || order.createdAt).toLocaleString('en-PH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        : new Date().toLocaleString('en-PH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
      status: order?.status ?? OrderStatusEnum.Pending,
      items: this.cart(),
      specialInstructions: this.orderSpecialInstructions(),
      totalAmount: order?.totalAmount ?? this.totalPrice(),
      paymentMethod: order?.paymentMethod ?? null,
      amountReceived: order?.amountReceived ?? null,
      changeAmount: order?.changeAmount ?? null,
      tips: order?.tips ?? null,
    };
  });

  protected itemCount = () => this.cart().reduce((s, i) => s + i.qty, 0);
  protected totalPrice = () =>
    this.cart().reduce((s, i) => {
      const addOnTotal = (i.addOns ?? []).reduce((a, ao) => a + ao.price, 0);
      return s + i.qty * (i.price + addOnTotal);
    }, 0);

  protected readonly categoryCounts = computed(() => {
    const cache = this.productsCache();
    return {
      [ProductCategoryEnum.Drink]: cache.filter((p) => p.category === ProductCategoryEnum.Drink)
        .length,
      [ProductCategoryEnum.Food]: cache.filter((p) => p.category === ProductCategoryEnum.Food)
        .length,
    };
  });

  protected selectSubCategoryTab(tab: ProductSubCategoryEnum): void {
    this.activeSubCategoryTab.set(tab);
    this.applyFiltersToCache();
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

  protected onOrderSpecialInstructionsInput(event: Event): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.orderSpecialInstructions.set(value);
  }

  public ngOnInit(): void {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (orderId) {
      this.isEditMode.set(true);
      this.loadCustomers();
      this.catalogCache.load();
      this.loadOrderForEditing(orderId);
    } else {
      this.restoreSavedCart();
      this.loadCatalog();
    }

    this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
      this.applyFiltersToCache();
    });
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

  private populateCartFromOrder(order: OrderDto): void {
    const cartItems: CartItemDto[] = order.items.map((item) => {
      // Expand add-ons: each add-on item may have quantity > 1
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

      return {
        productId: item.productId,
        name: '',
        price: item.price ?? 0,
        qty: item.quantity,
        imageUrl: '',
        addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
        specialInstructions: item.specialInstructions,
      };
    });
    this.cart.set(cartItems);
  }

  protected refreshProducts(): void {
    this.isRefreshing.set(true);

    this.catalogCache.refresh().then(() => {
      this.productsCache.set(this.catalogCache.products());
      this.customers.set(this.catalogCache.customers());
      this.applyFiltersToCache();
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

    const needsAddOns = this.cart().some((c) => c.addOns?.length);

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
    const enrichedCart = this.cart().map((cartItem) => {
      const product = allProducts.find((p) => p.id === cartItem.productId);
      const enrichedAddOns = cartItem.addOns?.map((ao) => {
        const addOnProduct = allProducts.find((p) => p.id === ao.addOnId);
        return addOnProduct ? { ...ao, name: addOnProduct.name } : ao;
      });

      return product
        ? {
            ...cartItem,
            name: product.name,
            imageUrl: product.imageUrl,
            addOns: enrichedAddOns,
          }
        : { ...cartItem, addOns: enrichedAddOns };
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

  protected onAddonSelected(event: {
    product: ProductDto;
    addOns: CartAddOnDto[];
    specialInstructions?: string | null;
  }): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const { product, addOns, specialInstructions } = event;

    // Only stack items without add-ons (plain products) and no special instructions
    if (addOns.length === 0 && !specialInstructions) {
      const existing = this.cart().find(
        (c) => c.productId === product.id && !c.addOns?.length && !c.specialInstructions,
      );

      if (existing) {
        this.cart.set(
          this.cart().map((c) =>
            c.productId === product.id && !c.addOns?.length && !c.specialInstructions
              ? { ...c, qty: c.qty + 1 }
              : c,
          ),
        );
        return;
      }
    }

    // Items with add-ons or special instructions always get their own cart line
    this.cart.set([
      ...this.cart(),
      {
        productId: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        imageUrl: product.imageUrl,
        addOns: addOns.length > 0 ? addOns : undefined,
        specialInstructions: specialInstructions || null,
      },
    ]);
  }

  // Helper for template add-on price calculation
  protected readonly addOnPriceReducer = (sum: number, ao: CartAddOnDto) => sum + ao.price;
  protected getUnitAddOnTotal(item: CartItemDto): number {
    return (item.addOns ?? []).reduce(this.addOnPriceReducer, 0);
  }

  protected getUnitSubtotal(item: CartItemDto): number {
    return item.price + this.getUnitAddOnTotal(item);
  }

  protected increment(productId: string, index: number): void {
    if (!this.canManageOrderActions()) {
      return;
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
    } else {
      this.cart.set(this.cart().map((c, i) => (i === index ? { ...c, qty: c.qty - 1 } : c)));
    }
  }

  protected clearAll(): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    this.cart.set([]);
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

  protected openOrderSummaryModal() {
    if (!this.showPaymentSummary()) {
      return;
    }
    this.showOrderSummaryModal.set(true);
    this.summaryModalStackId = this.modalStack.push(() => this.closeOrderSummaryModal());
  }

  protected closeOrderSummaryModal() {
    this.showOrderSummaryModal.set(false);
    this.removeStackId('summary');
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
    this.router.navigate(['/orders/list']);
  }

  public canDeactivate(): boolean | Promise<boolean> {
    // No guard for completed/cancelled orders, after successful save, or unchanged cart
    if (this.skipGuard || this.isReadOnly() || !this.hasCartChanged()) {
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

    this.showCancelOrderModal.set(true);
    this.cancelOrderModalStackId = this.modalStack.push(() => this.dismissCancelOrder());
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

    this.showCancelOrderModal.set(false);
    this.removeStackId('cancelOrder');

    this.orderService.voidOrder(order.id).subscribe({
      next: () => {
        this.skipGuard = true;

        const message =
          order.status === OrderStatusEnum.Completed
            ? 'Order has been refunded'
            : 'Order has been cancelled';

        this.alertService.success(message);
        this.router.navigate(['/orders/list']);
      },
      error: (err: Error) => {
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('order'));
      },
    });
  }

  protected dismissCancelOrder(): void {
    this.showCancelOrderModal.set(false);
    this.removeStackId('cancelOrder');
  }

  private removeStackId(modal: 'abandon' | 'cancelOrder' | 'summary' | 'createCustomer'): void {
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

    if (this.isEditMode()) {
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

    if (this.isEditMode()) {
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
      items: this.cart().map((c) => ({
        productId: c.productId,
        quantity: c.qty,
        addOns: this.groupAddOns(c.addOns),
        specialInstructions: c.specialInstructions || null,
      })),
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
        this.router.navigate(['/orders/list']);
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
        this.alertService.info(`Order ${localId} saved offline. It will sync when you're back online.`);
        this.router.navigate(['/orders/list']);
      })
      .catch(() => {
        this.isSavingOrder.set(false);
        this.alertService.error('Failed to save order offline.');
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
      items: this.cart().map((c) => ({
        productId: c.productId,
        quantity: c.qty,
        addOns: this.groupAddOns(c.addOns),
        specialInstructions: c.specialInstructions || null,
      })),
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
        this.router.navigate(['/orders/list']);
      },
      error: (err) => {
        this.isSavingOrder.set(false);
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('order'));
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
    const updated = this.cart().map((item) => {
      const product = productMap.get(item.productId);
      return product ? { ...item, imageUrl: product.imageUrl } : item;
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
    }));
  }
}
