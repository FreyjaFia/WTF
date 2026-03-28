import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService, CatalogCacheService, OrderService } from '@core/services';
import {
  AvatarComponent,
  BadgeComponent,
  IconComponent,
  OrderReceiptComponent,
  PullToRefreshComponent,
  ReceiptData,
} from '@shared/components';
import {
  ADD_ON_TYPE_ORDER,
  AddOnTypeEnum,
  CartAddOnDto,
  CartBundleItemDto,
  CartItemDto,
  OrderDto,
  OrderStatusEnum,
  PaymentMethodEnum,
  PromotionTypeEnum,
} from '@shared/models';
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
  ],
  templateUrl: './order-details.html',
})
export class OrderDetails implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderService = inject(OrderService);
  private readonly catalogCache = inject(CatalogCacheService);
  private readonly alertService = inject(AlertService);

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

  protected readonly canRefund = computed(() => this.order()?.status === OrderStatusEnum.Completed);
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

    return this.paymentOrderTotal() + this.paymentTipsAmount();
  });
  protected readonly paymentTotalPaid = computed(
    () => this.paymentAmountPaid() - this.paymentChangeAmount(),
  );
  protected readonly addOnPriceReducer = (sum: number, ao: CartAddOnDto) => sum + ao.price;
  protected readonly detailItems = computed<CartItemDto[]>(() => {
    const order = this.order();
    if (!order) {
      return [];
    }

    return this.mapOrderItemsToCartItems(order);
  });

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
    this.loadCatalogImages();
    this.loadOrder();
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
    const addOnUnitTotal = item.addOns.reduce(
      (sum, addOn) => sum + (addOn.price ?? 0) * addOn.quantity,
      0,
    );
    return ((item.price ?? 0) + addOnUnitTotal) * item.quantity;
  }

  protected getItemTotal(item: CartItemDto): number {
    if (item.bundleItems?.length) {
      return item.qty * item.price;
    }

    const addOnTotal = (item.addOns ?? []).reduce((sum, ao) => sum + ao.price, 0);
    return item.qty * (item.price + addOnTotal);
  }

  protected getUnitSubtotal(item: CartItemDto): number {
    if (item.bundleItems?.length) {
      return item.price;
    }

    const addOnTotal = (item.addOns ?? []).reduce((sum, ao) => sum + ao.price, 0);
    return item.price + addOnTotal;
  }

  protected getBundleChildTotalQuantity(bundleLine: CartItemDto, bundleItem: CartBundleItemDto): number {
    if (bundleLine.bundlePromotionTypeId === PromotionTypeEnum.MixMatch) {
      return Math.max(1, bundleItem.qty);
    }

    return Math.max(1, bundleLine.qty) * Math.max(1, bundleItem.qty);
  }

  protected getBundleChildDisplayRows(bundleLine: CartItemDto, bundleItem: CartBundleItemDto): number[] {
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
      .sort((a, b) => (a.sortOrder - b.sortOrder) || this.normalizeSortLabel(a.name).localeCompare(this.normalizeSortLabel(b.name)))
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

      regularItems.push({
        productId: item.productId,
        name: item.productName,
        price: item.price ?? 0,
        qty: item.quantity,
        imageUrl: this.getProductImage(item.productId),
        addOns: toAddOns(item),
        specialInstructions: item.specialInstructions ?? null,
      });
    }

    const bundleLines: CartItemDto[] = [];
    for (const [promotionId, items] of groupedBundleItems.entries()) {
      const bundleMeta = bundleMetaByPromotionId.get(promotionId);
      const bundleType =
        this.catalogCache.bundlePromotions().find((promo) => promo.id === promotionId)?.typeId ?? null;
      const bundleQty = Math.max(1, bundleMeta?.quantity ?? 1);
      const bundleItems: CartBundleItemDto[] = items.map((bundleItem) => ({
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
    return value.replace(/^\s*\d+\s*x\s+/i, '').trim().toLowerCase();
  }

  private loadOrder(): void {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (!orderId) {
      this.alertService.error('Order not found.');
      this.router.navigateByUrl(AppRoutes.OrdersList);
      return;
    }

    this.isLoading.set(true);
    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        this.order.set(order);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err: Error) => {
        this.alertService.error(err.message || this.alertService.getLoadErrorMessage('order'));
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
