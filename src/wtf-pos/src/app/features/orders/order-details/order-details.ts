import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertService,
  AuthService,
  CatalogCacheService,
  ConversationInboxService,
  OrderService,
  PromotionService,
  SignalRService,
} from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  IconComponent,
  OrderChatDrawerComponent,
  OrderReceiptComponent,
  PullToRefreshComponent,
  ReceiptData,
  RejectOrderDialogComponent,
} from '@shared/components';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog';
import {
  ADD_ON_TYPE_ORDER,
  AddOnTypeEnum,
  CartAddOnDto,
  CartBundleItemDto,
  CartItemDto,
  DiscountedProductItemDto,
  DiscountedProductPromotionDto,
  FulfillmentTypeEnum,
  OrderDto,
  OrderSourceEnum,
  OrderStatusEnum,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
import {
  findBestDiscount,
  formatPromoLabel,
  lineTotal,
  lineUnitSubtotal,
  promoDiscount,
  savedLineTotal,
  addMoney,
  sumAmounts,
  subtractMoney,
} from '@shared/calculations';
import { AppRoutes } from '@shared/constants/app-routes';

@Component({
  selector: 'app-order-details',
  imports: [
    CommonModule,
    IconComponent,
    BadgeComponent,
    AvatarComponent,
    PullToRefreshComponent,
    OrderReceiptComponent,
    ConfirmDialogComponent,
    RejectOrderDialogComponent,
    OrderChatDrawerComponent,
  ],
  templateUrl: './order-details.html',
})
export class OrderDetails implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderService = inject(OrderService);
  private readonly catalogCache = inject(CatalogCacheService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly promotionService = inject(PromotionService);
  private readonly inbox = inject(ConversationInboxService);
  private readonly signalR = inject(SignalRService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly showChat = signal(false);
  /** Messages from the customer that no staff member has read yet, for the badge on the Chat button. */
  protected readonly chatUnread = computed(() => {
    const id = this.order()?.id;
    return id ? this.inbox.unreadFor(id) : 0;
  });

  protected readonly order = signal<OrderDto | null>(null);
  protected readonly productImageById = signal<Record<string, string | null>>({});
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isDownloadingReceipt = signal(false);
  protected readonly isRefunding = signal(false);
  protected readonly showRefundModal = signal(false);
  protected readonly refundNote = signal('');
  protected readonly showRefundNoteError = signal(false);

  protected readonly itemCount = computed(() => {
    const current = this.order();
    if (!current) {
      return 0;
    }

    const nonBundleCount = current.items
      .filter((item) => !item.bundlePromotionId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const bundleCount = (current.bundlePromotions ?? []).reduce(
      (sum, bundle) => sum + bundle.quantity,
      0,
    );
    return nonBundleCount + bundleCount;
  });

  /** Placed by the customer through their ordering link (not by staff at the POS). */
  protected readonly isOnlineOrder = computed(
    () => this.order()?.source === OrderSourceEnum.CustomerLink,
  );
  protected readonly isAwaitingApproval = computed(
    () => this.order()?.status === OrderStatusEnum.PendingApproval,
  );
  protected readonly canDecide = computed(
    () => this.isAwaitingApproval() && this.authService.canWriteOrders(),
  );
  protected readonly isDeciding = signal(false);
  protected readonly showRejectDialog = signal(false);
  protected readonly isDelivery = computed(
    () => this.order()?.fulfillmentType === FulfillmentTypeEnum.Delivery,
  );

  protected readonly canRefund = computed(() => this.order()?.status === OrderStatusEnum.Completed);
  protected readonly canOverride = computed(
    () => this.canRefund() && this.authService.canOverrideOrders(),
  );
  protected readonly isCompleted = computed(
    () => this.order()?.status === OrderStatusEnum.Completed,
  );
  protected readonly isRefunded = computed(() => this.order()?.status === OrderStatusEnum.Refunded);
  protected readonly isCancelled = computed(
    () => this.order()?.status === OrderStatusEnum.Cancelled,
  );
  protected readonly paymentTipsAmount = computed(() => this.order()?.tips ?? 0);
  protected readonly paymentChangeAmount = computed(() => this.order()?.changeAmount ?? 0);
  protected readonly paymentOrderTotal = computed(() => this.order()?.totalAmount ?? 0);
  protected readonly paymentAmountPaid = computed(() => {
    const current = this.order();
    if (!current) {
      return 0;
    }

    if (current.amountReceived !== null && current.amountReceived !== undefined) {
      return current.amountReceived;
    }

    return addMoney(this.paymentOrderTotal(), this.paymentTipsAmount());
  });
  protected readonly paymentTotalPaid = computed(
    () => subtractMoney(this.paymentAmountPaid(), this.paymentChangeAmount()),
  );
  protected readonly discountedProductPromotions = signal<DiscountedProductPromotionDto[]>([]);
  protected readonly detailItems = computed<CartItemDto[]>(() => {
    const order = this.order();
    if (!order) {
      return [];
    }

    return this.mapOrderItemsToCartItems(order);
  });

  protected readonly paymentTotalDiscount = computed(() =>
    sumAmounts(this.detailItems().map((item) => item.promoDiscount ?? 0)),
  );

  protected readonly receiptData = computed<ReceiptData | null>(() => {
    const order = this.order();
    if (!order) {
      return null;
    }

    return {
      orderNumber: order.orderNumber,
      customerName: order.customerName || 'Walk-in customer',
      date: new Date(this.getOrderDate(order) || Date.now()).toLocaleString('en-PH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
      status: order.status,
      items: this.detailItems(),
      specialInstructions: order.specialInstructions ?? null,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod ?? null,
      amountReceived: order.amountReceived ?? null,
      changeAmount: order.changeAmount ?? null,
      tips: order.tips ?? null,
    };
  });

  public ngOnInit(): void {
    // A notification or the envelope sends staff here with ?chat=open. The parameter is cleared once used, so the same
    // link works again the next time.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('chat') === 'open') {
        this.showChat.set(true);
        void this.router.navigate([], {
          queryParams: { chat: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });

    // Another cashier or the customer's link changed this order: show it as it is now, without a spinner.
    this.signalR.startStaffOrdersHub();
    this.destroyRef.onDestroy(() => this.signalR.stopStaffOrdersHub());
    this.signalR.orderChanged.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((orderId) => {
      if (orderId === this.order()?.id) {
        this.loadOrder(true);
      }
    });

    this.loadCatalogImages();
    this.loadOrder();
    this.loadDiscountedProductPromotions();
  }

  protected openChat(): void {
    this.showChat.set(true);
  }

  protected closeChat(): void {
    this.showChat.set(false);
  }

  protected backToOrders(): void {
    this.router.navigateByUrl(AppRoutes.OrdersList);
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadOrder();
  }

  protected async downloadOrderImage(receipt: OrderReceiptComponent): Promise<void> {
    this.isDownloadingReceipt.set(true);
    try {
      await receipt.generate();
    } finally {
      this.isDownloadingReceipt.set(false);
    }
  }

  protected openOverrideEditor(): void {
    const current = this.order();
    if (!current || !this.canOverride()) {
      return;
    }

    this.router.navigate([AppRoutes.OrderEditorById(current.id)], {
      queryParams: { override: 1 },
    });
  }

  protected openRefundModal(): void {
    if (!this.canRefund()) {
      return;
    }

    this.refundNote.set(this.order()?.note ?? '');
    this.showRefundNoteError.set(false);
    this.showRefundModal.set(true);
  }

  protected dismissRefundModal(): void {
    this.showRefundModal.set(false);
    this.showRefundNoteError.set(false);
  }

  protected onRefundNoteInput(event: Event): void {
    const value = event.target instanceof HTMLTextAreaElement ? event.target.value : '';
    this.refundNote.set(value);
    if (this.showRefundNoteError() && value.trim()) {
      this.showRefundNoteError.set(false);
    }
  }

  protected confirmRefund(): void {
    const current = this.order();
    if (!current || !this.canRefund()) {
      return;
    }

    const note = this.refundNote().trim();
    if (!note) {
      this.showRefundNoteError.set(true);
      this.alertService.error('Refund note is required.');
      return;
    }

    this.isRefunding.set(true);
    this.orderService.voidOrder(current.id, note).subscribe({
      next: (updated) => {
        this.isRefunding.set(false);
        this.showRefundModal.set(false);
        this.showRefundNoteError.set(false);
        this.order.set(updated);
        this.alertService.success('Order has been refunded');
      },
      error: (err: Error) => {
        this.isRefunding.set(false);
        this.alertService.error(err.message || this.alertService.getUpdateErrorMessage('order'));
      },
    });
  }

  protected getStatusVariant(
    status?: OrderStatusEnum | null,
  ): 'success' | 'error' | 'warning' | 'info' | 'amber' | 'default' {
    switch (status) {
      case OrderStatusEnum.PendingApproval:
        return 'amber';
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
      case OrderStatusEnum.PendingApproval:
        return 'Awaiting approval';
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

  // --- orders waiting for approval ---

  protected approveOrder(): void {
    const current = this.order();
    if (!current || this.isDeciding() || !this.canDecide()) {
      return;
    }

    this.isDeciding.set(true);
    this.orderService.approveOrder(current.id).subscribe({
      next: (updated) => {
        this.isDeciding.set(false);
        this.order.set(updated);
        this.alertService.success(`Order #${current.orderNumber} accepted.`);
      },
      error: (err) => {
        this.isDeciding.set(false);
        this.alertService.error(err.message);
        // Someone else may have answered it already: show what the order really is now.
        this.refresh();
      },
    });
  }

  protected askRejectOrder(): void {
    if (!this.isDeciding() && this.canDecide()) {
      this.showRejectDialog.set(true);
    }
  }

  protected cancelRejectOrder(): void {
    if (!this.isDeciding()) {
      this.showRejectDialog.set(false);
    }
  }

  protected confirmRejectOrder(reason: string): void {
    const current = this.order();
    if (!current || this.isDeciding() || !this.canDecide()) {
      return;
    }

    this.isDeciding.set(true);
    this.orderService.rejectOrder(current.id, reason).subscribe({
      next: (updated) => {
        this.isDeciding.set(false);
        this.showRejectDialog.set(false);
        this.order.set(updated);
        this.alertService.success(`Order #${current.orderNumber} rejected.`);
      },
      error: (err) => {
        this.isDeciding.set(false);
        this.showRejectDialog.set(false);
        this.alertService.error(err.message);
        this.refresh();
      },
    });
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

  protected getOrderDate(order: OrderDto): string {
    return order.createdAt || order.updatedAt || '';
  }

  protected getOrderItemTotal(item: OrderDto['items'][number]): number {
    return savedLineTotal(item);
  }

  protected getItemTotal(item: CartItemDto): number {
    return lineTotal(item);
  }

  protected getUnitSubtotal(item: CartItemDto): number {
    return lineUnitSubtotal(item);
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

  protected getProductImage(productId: string): string | null {
    return this.productImageById()[productId] ?? null;
  }

  private async loadCatalogImages(): Promise<void> {
    await this.catalogCache.load();
    const map: Record<string, string | null> = {};
    for (const product of this.catalogCache.products()) {
      map[product.id] = product.imageUrl ?? null;
    }
    this.productImageById.set(map);
  }

  private loadDiscountedProductPromotions(): void {
    this.promotionService.getActiveDiscountedProductPromotions().subscribe({
      next: (promos) => this.discountedProductPromotions.set(promos),
      error: () => this.discountedProductPromotions.set([]),
    });
  }

  private mapOrderItemsToCartItems(order: OrderDto): CartItemDto[] {
    const toAddOns = (item: OrderDto['items'][number]): CartAddOnDto[] => {
      const expanded: CartAddOnDto[] = [];
      for (const addOn of item.addOns) {
        const addOnType = this.getAddOnTypeForOwner(item.productId, addOn.productId);

        for (let i = 0; i < addOn.quantity; i++) {
          expanded.push({
            addOnId: addOn.productId,
            name: addOn.productName,
            price: addOn.price ?? 0,
            addOnType,
          });
        }
      }

      return expanded;
    };

    const bundleMetaByPromotionId = new Map(
      (order.bundlePromotions ?? []).map((bundle) => [bundle.promotionId, bundle]),
    );
    const groupedBundleItems = new Map<
      string,
      {
        productId: string;
        productName: string;
        qty: number;
        price: number;
        addOns: CartAddOnDto[];
        specialInstructions?: string | null;
      }[]
    >();
    const regularItems: CartItemDto[] = [];

    for (const item of order.items) {
      if (item.bundlePromotionId) {
        const current = groupedBundleItems.get(item.bundlePromotionId) ?? [];
        current.push({
          productId: item.productId,
          productName: item.productName,
          qty: item.quantity,
          price: item.price ?? 0,
          addOns: toAddOns(item),
          specialInstructions: item.specialInstructions ?? null,
        });
        groupedBundleItems.set(item.bundlePromotionId, current);
        continue;
      }

      const cartItem: CartItemDto = {
        productId: item.productId,
        name: item.productName,
        price: item.price ?? 0,
        qty: item.quantity,
        imageUrl: this.getProductImage(item.productId),
        addOns: toAddOns(item),
        specialInstructions: item.specialInstructions ?? null,
      };
      if (item.originalPrice != null) {
        // The promotion was captured with the line, so show exactly what was applied.
        const discount = promoDiscount(item.originalPrice, cartItem.price, cartItem.qty);
        cartItem.promoLabel = item.promoLabel ?? null;
        cartItem.promoDiscount = discount > 0 ? discount : null;
      } else {
        // Older or not-yet-priced orders: best guess from the promotions active today.
        const promo = this.getBestDiscountedPromo(cartItem);
        if (promo) {
          const discount = promoDiscount(cartItem.price, promo.price, cartItem.qty);
          cartItem.promoLabel = formatPromoLabel(promo.entry);
          cartItem.promoDiscount = discount > 0 ? discount : null;
        }
      }
      regularItems.push(cartItem);
    }

    const bundleLines: CartItemDto[] = [];
    for (const [promotionId, items] of groupedBundleItems.entries()) {
      const bundleMeta = bundleMetaByPromotionId.get(promotionId);
      const bundleType =
        this.catalogCache.bundlePromotions().find((promo) => promo.id === promotionId)?.typeId ??
        null;
      const bundleQty = Math.max(1, bundleMeta?.quantity ?? 1);
      const bundleItems: CartBundleItemDto[] = items
        .map((bundleItem) => ({
          productId: bundleItem.productId,
          name: bundleItem.productName,
          price: bundleItem.price,
          qty:
            bundleType === PromotionTypeEnum.MixMatch
              ? Math.max(1, bundleItem.qty)
              : Math.max(1, Math.round(bundleItem.qty / bundleQty)),
          imageUrl: this.getProductImage(bundleItem.productId),
          addOns: bundleItem.addOns.length > 0 ? bundleItem.addOns : undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      bundleLines.push({
        productId: promotionId,
        name: bundleMeta?.promotionName ?? 'Bundle',
        price: bundleMeta?.unitPrice ?? 0,
        qty: bundleQty,
        imageUrl: null,
        specialInstructions:
          items.find((x) => (x.specialInstructions ?? '').trim().length > 0)?.specialInstructions ??
          null,
        bundlePromotionId: promotionId,
        bundlePromotionName: bundleMeta?.promotionName ?? 'Bundle',
        bundlePromotionTypeId: bundleType,
        bundleItems,
      });
    }

    return [...regularItems, ...bundleLines];
  }

  private getBestDiscountedPromo(
    item: CartItemDto,
  ): { entry: DiscountedProductItemDto; price: number } | null {
    if (item.bundleItems?.length || item.bundlePromotionId) {
      return null;
    }

    const rules = this.discountedProductPromotions()
      .flatMap((promo) => promo.items)
      .filter((entry) => entry.productId === item.productId);
    if (rules.length === 0) {
      return null;
    }

    const best = findBestDiscount(
      item.price,
      (item.addOns ?? []).map((addOn) => addOn.addOnId),
      rules,
    );
    return best ? { entry: best.rule, price: best.price } : null;
  }

  private getAddOnTypeForOwner(
    ownerProductId: string,
    addOnProductId: string,
  ): AddOnTypeEnum | undefined {
    const groups = this.catalogCache.getAddOnsForProduct(ownerProductId);

    for (const group of groups) {
      if (group.options.some((option) => option.id === addOnProductId)) {
        return group.type;
      }
    }

    return undefined;
  }

  private normalizeSortLabel(value: string): string {
    return value
      .replace(/^\s*\d+\s*x\s+/i, '')
      .trim()
      .toLowerCase();
  }

  private loadOrder(silent = false): void {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (!orderId) {
      this.alertService.error('Order not found.');
      this.router.navigateByUrl(AppRoutes.OrdersList);
      return;
    }

    if (!silent) {
      this.isLoading.set(true);
    }
    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        this.order.set(order);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        if (silent) {
          return;
        }
        this.alertService.error(err.message || this.alertService.getLoadErrorMessage('order'));
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
