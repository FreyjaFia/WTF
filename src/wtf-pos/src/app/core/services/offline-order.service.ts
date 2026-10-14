import { effect, inject, Injectable, signal } from '@angular/core';
import { AlertService, ConnectivityService, OrderService } from '@core/services';
import { CartItemDto, CreateOrderCommand } from '@shared/models';
import { firstValueFrom, timeout } from 'rxjs';
import { db } from './db';
import type { PendingOrder } from './db';

@Injectable({ providedIn: 'root' })
export class OfflineOrderService {
  private static readonly COUNTER_KEY = 'wtf-offline-counter';
  private static readonly SYNC_BATCH_SIZE = 5;
  private static readonly MAX_SYNC_ATTEMPTS = 3;
  private static readonly INITIAL_BACKOFF_MS = 500;
  /** A batch request that gets no answer for this long is given up on, so a hung server cannot leave orders syncing. */
  public static readonly SYNC_REQUEST_TIMEOUT_MS = 60_000;
  public static readonly TIMED_OUT_MESSAGE =
    'The server took too long to answer. Check the orders list before syncing again, in case the order already went through.';

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
  private wasOnline = false;

  constructor() {
    void this.recoverInterruptedSync();

    // Automatic sync. An order that just failed must NOT start another sync by itself: marking it failed changes
    // the list, which would run this again at once and loop against a server that keeps failing (every card flickers
    // "Syncing" and Sync Now finds a sync already running). Failed orders are tried again when the connection
    // returns, or when the user presses Sync Now. Orders still waiting are sent as soon as they can be.
    effect(() => {
      const online = this.connectivity.isOnline();
      const isAuthenticated = this.isAuthenticated();
      const hasActiveOfflineEdit = this._activeOfflineEdits().length > 0;
      const orders = this._pendingOrders();
      const reconnected = online && !this.wasOnline;
      this.wasOnline = online;

      const hasWaiting = orders.some((order) => order.status === 'pending');
      const hasFailed = orders.some((order) => order.status === 'failed');

      if (
        online &&
        isAuthenticated &&
        !hasActiveOfflineEdit &&
        (hasWaiting || (reconnected && hasFailed))
      ) {
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
    previewTotal: number | null = null,
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
      previewTotal,
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
    previewTotal: number | null = null,
  ): Promise<void> {
    const existing = await db.pendingOrders.where('localId').equals(localId).first();

    if (!existing) {
      return;
    }

    await (db.pendingOrders as import('dexie').Table).update(existing.id!, {
      command,
      cartSnapshot,
      previewTotal,
      customerName,
      status: 'pending',
      errorMessage: null,
    });

    await this.loadPendingOrders();
  }

  /**
   * What the Sync Now button does: the same as <see cref="syncAll"/>, but when sync cannot start it says why instead
   * of doing nothing.
   */
  public async syncNow(): Promise<void> {
    if (this.syncInProgress) {
      this.alertService.warning('Orders are already syncing. Please wait a moment.');
      return;
    }

    if (!this.connectivity.isOnline()) {
      this.alertService.warning('You are offline. Orders will sync when the connection returns.');
      return;
    }

    if (!this.isAuthenticated()) {
      this.alertService.warning('Please sign in again to sync your offline orders.');
      return;
    }

    if (this._activeOfflineEdits().length > 0) {
      this.alertService.warning('Close the offline order you are editing, then sync again.');
      return;
    }

    await this.syncAll();
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
              this.orderService
                .createOrdersBatch(batch.map((order) => this.buildBatchCommand(order)))
                .pipe(timeout(OfflineOrderService.SYNC_REQUEST_TIMEOUT_MS)),
            ),
          );

          await db.pendingOrders.bulkDelete(batchIds);
          successCount += batch.length;
        } catch (err: unknown) {
          const message =
            this.isTimeout(err)
              ? OfflineOrderService.TIMED_OUT_MESSAGE
              : err instanceof Error
                ? err.message
                : 'Unknown error';
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

  /**
   * An order is marked syncing while its request runs. If the page was closed or reloaded in the middle, nothing is
   * running any more but the mark stays, and the order could never be sent or opened again. A new service instance
   * means no sync is running, so any order still syncing was interrupted: put it back to pending.
   */
  private async recoverInterruptedSync(): Promise<void> {
    const stuck = (await db.pendingOrders.toArray()).filter((order) => order.status === 'syncing');

    if (stuck.length > 0) {
      await (db.pendingOrders as import('dexie').Table).bulkUpdate(
        stuck.map((order) => ({ key: order.id!, changes: { status: 'pending' } })),
      );
    }

    await this.loadPendingOrders();
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

  /** The error the timeout operator raises (matched by name, so it is found wherever the library was loaded from). */
  private isTimeout(error: unknown): boolean {
    return error instanceof Error && error.name === 'TimeoutError';
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

        // The server may have created the order even though it never answered, so asking again could save it twice.
        if (this.isTimeout(error)) {
          break;
        }

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
