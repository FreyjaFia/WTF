import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, AuthService, CustomerService, OrderService, ProductService } from '@core/services';
import type { CustomerDropdownOption, FilterOption } from '@shared/components';
import {
  AddonSelectorComponent,
  AvatarComponent,
  BadgeComponent,
  CustomerDropdown,
  FilterDropdown,
  Icon,
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
  UpdateOrderCommand,
} from '@shared/models';
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
    FilterDropdown,
    CustomerDropdown,
    AddonSelectorComponent,
    AvatarComponent,
    BadgeComponent,
  ],
  templateUrl: './order-editor.html',
})
export class OrderEditor implements OnInit {
  private readonly checkoutModal = viewChild.required(CheckoutModal);
  private readonly addonSelector = viewChild.required(AddonSelectorComponent);
  private readonly productService = inject(ProductService);
  private readonly orderService = inject(OrderService);
  private readonly customerService = inject(CustomerService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alertService = inject(AlertService);

  // Order-level special instructions state
  public readonly orderSpecialInstructions = signal('');
  protected readonly showOrderSpecialInstructions = signal(false);

  // Abandon order guard
  protected readonly showAbandonModal = signal(false);
  private pendingDeactivateResolve: ((value: boolean) => void) | null = null;
  private skipGuard = false;
  private originalCartSnapshot = '';

  // Cancel order
  protected readonly showCancelOrderModal = signal(false);
  protected readonly showOrderSummaryModal = signal(false);
  protected readonly showCreateCustomerModal = signal(false);
  protected readonly isCreatingCustomer = signal(false);
  protected readonly isSavingOrder = signal(false);

  protected readonly createCustomerForm = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly filterForm = new FormGroup({
    searchTerm: new FormControl(''),
  });
  protected readonly selectedProductCategories = signal<ProductCategoryEnum[]>([]);
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

  protected readonly filterOptions = computed<FilterOption[]>(() => [
    {
      id: ProductCategoryEnum.Drink,
      label: 'Drink',
      count: this.categoryCounts()[ProductCategoryEnum.Drink],
    },
    {
      id: ProductCategoryEnum.Food,
      label: 'Food',
      count: this.categoryCounts()[ProductCategoryEnum.Food],
    },
  ]);

  protected onOrderSpecialInstructionsInput(event: Event): void {
    if (!this.canManageOrderActions()) {
      return;
    }

    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.orderSpecialInstructions.set(value);
  }

  public ngOnInit(): void {
    this.loadCustomers();

    const orderId = this.route.snapshot.paramMap.get('id');
    if (orderId) {
      this.isEditMode.set(true);
      this.loadOrderForEditing(orderId);
    } else {
      this.loadProducts();
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
    const isReadOnly =
      order.status === OrderStatusEnum.Completed ||
      order.status === OrderStatusEnum.Cancelled ||
      order.status === OrderStatusEnum.Refunded;

    const cartItems: CartItemDto[] = order.items.map((item) => {
      // Expand add-ons: each add-on item may have quantity > 1
      const expandedAddOns: CartAddOnDto[] = [];

      for (const ao of item.addOns ?? []) {
        for (let i = 0; i < ao.quantity; i++) {
          expandedAddOns.push({
            addOnId: ao.productId,
            name: '',
            price: 0,
          });
        }
      }

      return {
        productId: item.productId,
        name: '',
        price: isReadOnly ? (item.price ?? 0) : 0,
        qty: item.quantity,
        imageUrl: '',
        addOns: expandedAddOns.length > 0 ? expandedAddOns : undefined,
        specialInstructions: item.specialInstructions,
      };
    });
    this.cart.set(cartItems);
  }

  private loadProducts(): void {
    this.isLoading.set(true);

    const { searchTerm } = this.filterForm.value;

    this.productService
      .getProducts({
        searchTerm: searchTerm || null,
        category: null,
        isAddOn: false,
        isActive: true,
      })
      .subscribe({
        next: (result) => {
          this.productsCache.set(result);
          this.applyFiltersToCache();
          this.isLoading.set(false);
        },
        error: (err: Error) => {
          this.alertService.error(err.message || this.alertService.getLoadErrorMessage('products'));
          this.isLoading.set(false);
        },
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

  /**
   * Loads products for edit mode — fetches the product grid and (if needed)
   * all products to resolve add-on names/prices. Returns an observable so
   * it can be chained after the order fetch.
   */
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
        return addOnProduct ? { ...ao, name: addOnProduct.name, price: addOnProduct.price } : ao;
      });

      return product
        ? {
            ...cartItem,
            name: product.name,
            price: this.isReadOnly() ? cartItem.price : product.price,
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
  }

  protected closeOrderSummaryModal() {
    this.showOrderSummaryModal.set(false);
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
  }

  protected closeCreateCustomerModal(): void {
    if (this.isCreatingCustomer()) {
      return;
    }
    this.showCreateCustomerModal.set(false);
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
          this.isCreatingCustomer.set(false);
          this.alertService.successCreated('Customer');
        },
        error: (err: Error) => {
          this.isCreatingCustomer.set(false);
          this.alertService.error(err.message || this.alertService.getCreateErrorMessage('customer'));
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

    return new Promise<boolean>((resolve) => {
      this.pendingDeactivateResolve = resolve;
    });
  }

  protected confirmAbandon(): void {
    this.showAbandonModal.set(false);

    if (this.pendingDeactivateResolve) {
      this.pendingDeactivateResolve(true);
      this.pendingDeactivateResolve = null;
    }
  }

  protected cancelAbandon(): void {
    this.showAbandonModal.set(false);

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

    this.orderService.createOrder(command).subscribe({
      next: () => {
        this.isSavingOrder.set(false);
        this.skipGuard = true;
        this.router.navigate(['/orders/list']);
      },
      error: (err) => {
        this.isSavingOrder.set(false);
        this.alertService.error(err.message || this.alertService.getCreateErrorMessage('order'));
      },
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
        this.router.navigate(['/orders/list']);
      },
      error: (err) => {
        this.isSavingOrder.set(false);
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('order'));
      },
    });
  }

  private applyFiltersToCache(): void {
    const { searchTerm } = this.filterForm.value;

    const allowedCategories = this.selectedProductCategories();

    let items = [...this.productsCache()];

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(lowerSearchTerm));
    }

    if (allowedCategories.length > 0) {
      items = items.filter((p) => allowedCategories.includes(p.category));
    }

    this.products.set(items);
  }

  protected onProductCategoryFilterChange(selectedIds: (string | number)[]): void {
    this.selectedProductCategories.set(selectedIds as ProductCategoryEnum[]);
    this.applyFiltersToCache();
  }

  protected onProductCategoryFilterReset(): void {
    this.selectedProductCategories.set([]);
    this.applyFiltersToCache();
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
