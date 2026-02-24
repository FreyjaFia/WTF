import { effect, inject, Injectable, signal } from '@angular/core';
import { AlertService, ConnectivityService, OrderService } from '@core/services';
import { CartItemDto, CreateOrderCommand } from '@shared/models';
import { firstValueFrom } from 'rxjs';
import { db } from './db';
import type { PendingOrder } from './db';

@Injectable({ providedIn: 'root' })
export class OfflineOrderService {
  private readonly connectivity = inject(ConnectivityService);
  private readonly orderService = inject(OrderService);
  private readonly alertService = inject(AlertService);

  private readonly _pendingOrders = signal<PendingOrder[]>([]);
  public readonly pendingOrders = this._pendingOrders.asReadonly();

  private readonly _isSyncing = signal(false);
  public readonly isSyncing = this._isSyncing.asReadonly();

  private localCounter = 0;
  private syncInProgress = false;

  constructor() {
    this.loadPendingOrders();

    effect(() => {
      const online = this.connectivity.isOnline();

      if (online && this._pendingOrders().length > 0) {
        this.syncAll();
      }
    });
  }

  public async queue(
    command: CreateOrderCommand,
    cartSnapshot: CartItemDto[],
    customerName: string | null,
  ): Promise<string> {
    this.localCounter++;
    const localId = `L-${String(this.localCounter).padStart(3, '0')}`;

    const pendingOrder: PendingOrder = {
      localId,
      command,
      cartSnapshot,
      customerName,
      createdAt: new Date().toISOString(),
      status: 'pending',
      errorMessage: null,
      retryCount: 0,
    };

    await db.pendingOrders.add(pendingOrder);
    await this.loadPendingOrders();

    return localId;
  }

  public async remove(localId: string): Promise<void> {
    await db.pendingOrders.where('localId').equals(localId).delete();
    await this.loadPendingOrders();
  }

  public async syncAll(): Promise<void> {
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;
    this._isSyncing.set(true);

    try {
      const orders = await db.pendingOrders.where('status').anyOf(['pending', 'failed']).toArray();

      let successCount = 0;
      let failCount = 0;

      for (const order of orders) {
        if (!this.connectivity.isOnline()) {
          break;
        }

        await (db.pendingOrders as import('dexie').Table).update(order.id!, { status: 'syncing' });
        await this.loadPendingOrders();

        try {
          await firstValueFrom(this.orderService.createOrder(order.command));
          await db.pendingOrders.delete(order.id!);
          successCount++;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          failCount++;

          await (db.pendingOrders as import('dexie').Table).update(order.id!, {
            status: 'failed',
            errorMessage: message,
            retryCount: order.retryCount + 1,
          });
        }
      }

      await this.loadPendingOrders();

      if (successCount > 0) {
        this.alertService.success(
          `${successCount} offline order${successCount > 1 ? 's' : ''} synced successfully.`,
        );
      }

      if (failCount > 0) {
        this.alertService.warning(
          `${failCount} order${failCount > 1 ? 's' : ''} failed to sync. Check pending orders.`,
        );
      }
    } finally {
      this.syncInProgress = false;
      this._isSyncing.set(false);
    }
  }

  private async loadPendingOrders(): Promise<void> {
    const orders = await db.pendingOrders.toArray();
    this._pendingOrders.set(orders);
    this.updateLocalCounter(orders);
  }

  private updateLocalCounter(orders: PendingOrder[]): void {
    let maxNum = 0;

    for (const order of orders) {
      const match = order.localId.match(/^L-(\d+)$/);

      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }

    this.localCounter = maxNum;
  }
}
