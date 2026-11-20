import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { ConnectivityService } from '@core/services/connectivity.service';
import { OrderService } from '@core/services/order.service';
import { UnsyncedOrderService } from '@core/services/unsynced-order.service';
import { OrderStatusEnum, UnsyncedOrderStatusEnum } from '@shared/models';

const POLL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class NeedsAttentionService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly orderService = inject(OrderService);
  private readonly unsyncedService = inject(UnsyncedOrderService);

  private readonly _awaiting = signal(0);
  private readonly _held = signal(0);
  private readonly _unsynced = signal(0);

  public readonly awaiting = this._awaiting.asReadonly();
  public readonly held = this._held.asReadonly();
  public readonly unsynced = this._unsynced.asReadonly();
  public readonly total = computed(() => this._awaiting() + this._held() + this._unsynced());

  private usage = 0;
  private wasOnline = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  public constructor() {
    // What a person may act on is known a moment after sign-in, and the connection comes and goes: ask again at both.
    effect(() => {
      const online = this.connectivity.isOnline();
      const mayWrite = this.auth.canWriteOrders();
      const mayOverride = this.auth.canOverrideOrders();
      const reconnected = online && !this.wasOnline;
      this.wasOnline = online;

      if (this.usage > 0 && (mayWrite || mayOverride || reconnected)) {
        untracked(() => this.refresh());
      }
    });
  }

  public start(): void {
    this.usage += 1;
    if (this.usage > 1) {
      return;
    }

    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.refresh();
  }

  public stop(): void {
    if (this.usage === 0) {
      return;
    }

    this.usage -= 1;
    if (this.usage === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public refresh(): void {
    if (!this.connectivity.isOnline() || !this.auth.isAuthenticated()) {
      return;
    }

    // The server answers for the branch that is open, so the counts follow the branch switcher.
    if (this.auth.canWriteOrders()) {
      this.orderService
        .getOrdersPaged({ status: OrderStatusEnum.PendingApproval, page: 1, pageSize: 1 })
        .subscribe({ next: (r) => this._awaiting.set(r.totalCount), error: () => undefined });
    }

    if (this.auth.canOverrideOrders()) {
      this.orderService
        .getOrdersPaged({ status: OrderStatusEnum.PendingReview, page: 1, pageSize: 1 })
        .subscribe({ next: (r) => this._held.set(r.totalCount), error: () => undefined });
      this.unsyncedService
        .getUnsyncedOrders({ status: UnsyncedOrderStatusEnum.Open, page: 1, pageSize: 1 })
        .subscribe({ next: (r) => this._unsynced.set(r.totalCount), error: () => undefined });
    }
  }

  public ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }
}
