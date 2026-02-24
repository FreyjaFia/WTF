import { effect, inject, Injectable, signal } from '@angular/core';
import { AlertService, ConnectivityService, OrderService } from '@core/services';
import { CartItemDto, CreateOrderCommand } from '@shared/models';
import { firstValueFrom } from 'rxjs';
import { db } from './db';
import type { PendingOrder } from './db';

@Injectable({ providedIn: 'root' })
export class OfflineOrderService {
  private static readonly COUNTER_KEY = 'wtf-offline-counter';
  private static readonly SYNC_BATCH_SIZE = 5;
  private static readonly MAX_SYNC_ATTEMPTS = 3;
  private static readonly INITIAL_BACKOFF_MS = 500;

  private readonly connectivity = inject(ConnectivityService);
  private readonly orderService = inject(OrderService);
  private readonly alertService = inject(AlertService);

  private readonly _pendingOrders = signal<PendingOrder[]>([]);
  public readonly pendingOrders = this._pendingOrders.asReadonly();

  private readonly _isSyncing = signal(false);
  public readonly isSyncing = this._isSyncing.asReadonly();
  private readonly _activeOfflineEdits = signal<string[]>([]);

  private localCounter = 0;
  private syncInProgress = false;

  constructor() {
    this.loadPendingOrders();

    effect(() => {
      const online = this.connectivity.isOnline();
      const isAuthenticated = this.isAuthenticated();
      const hasActiveOfflineEdit = this._activeOfflineEdits().length > 0;

      if (online && isAuthenticated && !hasActiveOfflineEdit && this._pendingOrders().length > 0) {
        this.syncAll();
      }
    });
  }

  public lockSyncForOfflineEdit(localId: string): void {
    const current = this._activeOfflineEdits();

    if (current.includes(localId)) {
      return;
    }

    this._activeOfflineEdits.set([...current, localId]);
  }

  public unlockSyncForOfflineEdit(localId: string): void {
    const next = this._activeOfflineEdits().filter((id) => id !== localId);
    this._activeOfflineEdits.set(next);
  }

  public async queue(
    command: CreateOrderCommand,
    cartSnapshot: CartItemDto[],
    customerName: string | null,
  ): Promise<string> {
    const today = this.getTodayString();
    this.localCounter++;
    const localId = `OFF-${today}-${String(this.localCounter).padStart(3, '0')}`;

    localStorage.setItem(
      OfflineOrderService.COUNTER_KEY,
      JSON.stringify({ date: today, counter: this.localCounter }),
    );

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

  public async get(localId: string): Promise<PendingOrder | undefined> {
    return db.pendingOrders.where('localId').equals(localId).first();
  }

  public async update(
    localId: string,
    command: CreateOrderCommand,
    cartSnapshot: CartItemDto[],
    customerName: string | null,
  ): Promise<void> {
    const existing = await db.pendingOrders.where('localId').equals(localId).first();

    if (!existing) {
      return;
    }

    await (db.pendingOrders as import('dexie').Table).update(existing.id!, {
      command,
      cartSnapshot,
      customerName,
      status: 'pending',
      errorMessage: null,
    });

    await this.loadPendingOrders();
  }

  public async syncAll(): Promise<void> {
    if (
      this.syncInProgress ||
      !this.isAuthenticated() ||
      this._activeOfflineEdits().length > 0
    ) {
      return;
    }

    this.syncInProgress = true;
    this._isSyncing.set(true);

    try {
      const orders = await db.pendingOrders
        .where('status')
        .anyOf(['pending', 'failed'])
        .sortBy('createdAt');
      const batches = this.chunkOrders(orders, OfflineOrderService.SYNC_BATCH_SIZE);

      let successCount = 0;
      let failCount = 0;

      for (const batch of batches) {
        if (!this.connectivity.isOnline()) {
          break;
        }

        const batchIds = batch.map((order) => order.id!).filter((id) => id !== undefined);
        await (db.pendingOrders as import('dexie').Table).bulkUpdate(
          batchIds.map((id) => ({ key: id, changes: { status: 'syncing' } })),
        );
        await this.loadPendingOrders();

        try {
          await this.retryWithBackoff(() =>
            firstValueFrom(
              this.orderService.createOrdersBatch(
                batch.map((order) => this.buildBatchCommand(order)),
              ),
            ),
          );

          await db.pendingOrders.bulkDelete(batchIds);
          successCount += batch.length;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          failCount += batch.length;

          await (db.pendingOrders as import('dexie').Table).bulkUpdate(
            batch.map((order) => ({
              key: order.id!,
              changes: {
                status: 'failed',
                errorMessage: message,
                retryCount: order.retryCount + 1,
              },
            })),
          );
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
    const today = this.getTodayString();
    let maxNum = 0;

    for (const order of orders) {
      const match = order.localId.match(/^OFF-(\d{6})-(\d+)$/);

      if (match && match[1] === today) {
        maxNum = Math.max(maxNum, parseInt(match[2], 10));
      }
    }

    try {
      const saved = localStorage.getItem(OfflineOrderService.COUNTER_KEY);

      if (saved) {
        const parsed = JSON.parse(saved) as { date: string; counter: number };

        if (parsed.date === today) {
          maxNum = Math.max(maxNum, parsed.counter);
        }
      }
    } catch {
      // Ignore parse errors
    }

    this.localCounter = maxNum;
  }

  private getTodayString(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    return `${yy}${mm}${dd}`;
  }

  public async getPendingSyncCount(): Promise<number> {
    return db.pendingOrders.count();
  }

  private buildBatchCommand(order: PendingOrder): CreateOrderCommand {
    return {
      ...order.command,
      createdAt: new Date(order.createdAt).toISOString(),
    };
  }

  private chunkOrders(orders: PendingOrder[], size: number): PendingOrder[][] {
    const chunks: PendingOrder[][] = [];

    for (let i = 0; i < orders.length; i += size) {
      chunks.push(orders.slice(i, i + size));
    }

    return chunks;
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < OfflineOrderService.MAX_SYNC_ATTEMPTS) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        attempt++;

        if (attempt >= OfflineOrderService.MAX_SYNC_ATTEMPTS) {
          break;
        }

        const delayMs = OfflineOrderService.INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), ms);
    });
  }

  private isAuthenticated(): boolean {
    return !!localStorage.getItem('token');
  }
}
