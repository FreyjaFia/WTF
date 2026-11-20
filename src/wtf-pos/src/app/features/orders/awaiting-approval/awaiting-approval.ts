import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  ConnectivityService,
  NeedsAttentionService,
  OrderService,
  SignalRService,
} from '@core/services';
import {
  ConnectionErrorComponent,
  IconComponent,
  PullToRefreshComponent,
  RejectOrderDialogComponent,
} from '@shared/components';
import { BadgeComponent } from '@shared/components/badge/badge';
import { OrderChatDrawerComponent } from '@shared/components/order-chat-drawer/order-chat-drawer';
import { PaginationComponent } from '@shared/components/pagination/pagination';
import { AppRoutes } from '@shared/constants/app-routes';
import { FulfillmentTypeEnum, OrderDto, OrderStatusEnum, PaymentMethodEnum } from '@shared/models';
import { ClientPager } from '@shared/utils/client-pager';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-awaiting-approval',
  imports: [
    BadgeComponent,
    ConnectionErrorComponent,
    DatePipe,
    DecimalPipe,
    IconComponent,
    OrderChatDrawerComponent,
    PaginationComponent,
    PullToRefreshComponent,
    RejectOrderDialogComponent,
  ],
  templateUrl: './awaiting-approval.html',
  host: { class: 'flex-1 min-h-0' },
})
export class AwaitingApproval implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly orderService = inject(OrderService);
  private readonly alertService = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly signalR = inject(SignalRService);
  private readonly attention = inject(NeedsAttentionService);

  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly decidingOrderId = signal<string | null>(null);
  protected readonly orderToReject = signal<OrderDto | null>(null);
  protected readonly chatOrder = signal<OrderDto | null>(null);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly canDecideOrders = computed(() => this.authService.canWriteOrders());
  protected readonly canChat = computed(() => this.authService.canReadChat());
  protected readonly PaymentMethodEnum = PaymentMethodEnum;
  protected readonly pager = new ClientPager(this.orders, 'orders:awaiting');

  private hubSub: Subscription | null = null;
  private wasOnline = false;

  public constructor() {
    // The connection may only be confirmed after the page opens, and it can drop and return: load whenever it comes back.
    effect(() => {
      const online = this.connectivity.isOnline();
      const reconnected = online && !this.wasOnline;
      this.wasOnline = online;

      if (reconnected) {
        untracked(() => this.load());
      }
    });
  }

  public ngOnInit(): void {
    this.signalR.startStaffOrdersHub();
    this.hubSub = this.signalR.orderChanged.subscribe((orderId) => this.handleOrderChanged(orderId));
  }

  public ngOnDestroy(): void {
    this.hubSub?.unsubscribe();
    this.signalR.stopStaffOrdersHub();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.load();
  }

  protected openOrder(order: OrderDto): void {
    void this.router.navigateByUrl(AppRoutes.OrderDetailsById(order.id));
  }

  protected isDelivery(order: OrderDto): boolean {
    return order.fulfillmentType === FulfillmentTypeEnum.Delivery;
  }

  protected getItemsText(order: OrderDto): string {
    const nonBundleCount = order.items
      .filter((item) => !item.bundlePromotionId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const bundleCount = (order.bundlePromotions ?? []).reduce((sum, bundle) => sum + bundle.quantity, 0);
    const count = nonBundleCount + bundleCount;
    return count === 1 ? '1 item' : `${count} items`;
  }

  protected openChat(order: OrderDto): void {
    this.chatOrder.set(order);
  }

  protected closeChat(): void {
    this.chatOrder.set(null);
  }

  protected approve(order: OrderDto): void {
    if (this.decidingOrderId() || !this.canDecideOrders()) {
      return;
    }

    this.decidingOrderId.set(order.id);
    this.orderService.approveOrder(order.id).subscribe({
      next: () => {
        this.decidingOrderId.set(null);
        this.remove(order.id);
        this.alertService.success(`Order #${order.orderNumber} accepted.`);
      },
      error: (err) => {
        this.decidingOrderId.set(null);
        this.alertService.error(err.message);
        // Someone else may already have answered it: show what is really waiting now.
        this.load();
      },
    });
  }

  protected askReject(order: OrderDto): void {
    if (this.decidingOrderId() || !this.canDecideOrders()) {
      return;
    }

    this.orderToReject.set(order);
  }

  protected cancelReject(): void {
    if (this.decidingOrderId()) {
      return;
    }

    this.orderToReject.set(null);
  }

  protected confirmReject(reason: string): void {
    const order = this.orderToReject();
    if (!order || this.decidingOrderId() || !this.canDecideOrders()) {
      return;
    }

    this.decidingOrderId.set(order.id);
    this.orderService.rejectOrder(order.id, reason).subscribe({
      next: () => {
        this.decidingOrderId.set(null);
        this.orderToReject.set(null);
        this.remove(order.id);
        this.alertService.success(`Order #${order.orderNumber} rejected.`);
      },
      error: (err) => {
        this.decidingOrderId.set(null);
        this.orderToReject.set(null);
        this.alertService.error(err.message);
        this.load();
      },
    });
  }

  private load(): void {
    if (!this.connectivity.isOnline()) {
      this.isRefreshing.set(false);
      return;
    }

    this.connectionFailed.set(false);
    this.isLoading.set(this.orders().length === 0);
    this.orderService.getAwaitingOrders().subscribe({
      next: (orders) => {
        this.orders.set(this.oldestFirst(orders));
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.attention.refresh();
      },
      error: (err) => {
        this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
        if (!this.connectionFailed()) {
          this.alertService.error(err.message || this.alertService.getLoadErrorMessage('orders'));
        }

        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }

  private handleOrderChanged(orderId: string): void {
    if (!orderId || !this.connectivity.isOnline()) {
      return;
    }

    this.orderService.getOrder(orderId).subscribe({
      next: (order) => {
        if (order.status === OrderStatusEnum.PendingApproval) {
          const rest = this.orders().filter((o) => o.id !== order.id);
          this.orders.set(this.oldestFirst([...rest, order]));
        } else {
          this.remove(order.id);
        }

        this.attention.refresh();
      },
      error: () => {
        // A background update; the next refresh shows the truth.
      },
    });
  }

  private remove(orderId: string): void {
    this.orders.set(this.orders().filter((o) => o.id !== orderId));
    this.attention.refresh();
  }

  private oldestFirst(orders: OrderDto[]): OrderDto[] {
    return [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
