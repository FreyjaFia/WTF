import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AlertService, ConnectivityService, OrderService } from '@core/services';
import { CartItemDto, CreateOrderCommand } from '@shared/models';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import type { PendingOrder } from './db';
import { OfflineOrderService } from './offline-order.service';

type Row = PendingOrder & Record<string, unknown>;

/** Minimal in-memory stand-in for the Dexie `pendingOrders` table. */
class FakeTable {
  public rows: Row[] = [];
  private nextId = 1;

  public add(order: PendingOrder): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ ...order, id } as Row);
    return Promise.resolve(id);
  }

  public toArray(): Promise<Row[]> {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }

  public count(): Promise<number> {
    return Promise.resolve(this.rows.length);
  }

  public where(field: string) {
    const matching = (predicate: (value: unknown) => boolean) =>
      this.rows.filter((r) => predicate(r[field]));
    return {
      equals: (value: unknown) => ({
        delete: () => {
          this.rows = this.rows.filter((r) => r[field] !== value);
          return Promise.resolve();
        },
        first: () => Promise.resolve(matching((v) => v === value)[0]),
      }),
      anyOf: (values: unknown[]) => ({
        sortBy: (key: string) =>
          Promise.resolve(
            matching((v) => values.includes(v)).sort((a, b) =>
              String(a[key]).localeCompare(String(b[key])),
            ),
          ),
      }),
    };
  }

  public update(id: number, changes: Record<string, unknown>): Promise<number> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      Object.assign(row, changes);
    }
    return Promise.resolve(row ? 1 : 0);
  }

  public bulkUpdate(items: { key: number; changes: Record<string, unknown> }[]): Promise<number> {
    items.forEach((i) => this.update(i.key, i.changes));
    return Promise.resolve(items.length);
  }

  public bulkDelete(ids: number[]): Promise<void> {
    this.rows = this.rows.filter((r) => !ids.includes(r.id as number));
    return Promise.resolve();
  }
}

/** What the server answers for orders it saved: one result per order, matched by the queue number it was sent. */
const saved = (batch: { offlineLocalId?: string }[], status = 2) =>
  batch.map((c) => ({
    offlineLocalId: c.offlineLocalId,
    orderId: 'srv',
    orderNumber: 1,
    status,
    reasons: [] as string[],
    error: null,
  }));

const command = (tag = 'a') => ({ note: tag }) as unknown as CreateOrderCommand;
const cart = [] as CartItemDto[];

function today(): string {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

describe('OfflineOrderService', () => {
  const originalTable = db.pendingOrders;
  let table: FakeTable;
  let online: ReturnType<typeof signal<boolean>>;
  let createBatch: ReturnType<typeof vi.fn>;
  let alerts: { success: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };

  async function create(seed: Partial<PendingOrder>[] = []): Promise<OfflineOrderService> {
    for (const row of seed) {
      await table.add({
        localId: 'OFF-x-001',
        command: command(),
        cartSnapshot: cart,
        customerName: null,
        createdAt: new Date().toISOString(),
        status: 'pending',
        retryCount: 0,
        ...row,
      });
    }
    const service = TestBed.inject(OfflineOrderService);
    await vi.advanceTimersByTimeAsync(0);
    return service;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    table = new FakeTable();
    Object.defineProperty(db, 'pendingOrders', { value: table, configurable: true, writable: true });
    online = signal(false);
    createBatch = vi.fn(
      (batch: { offlineLocalId?: string }[]) => of(saved(batch)) as Observable<unknown>,
    );
    alerts = { success: vi.fn(), warning: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectivityService, useValue: { isOnline: online } },
        { provide: OrderService, useValue: { syncOfflineOrders: createBatch } },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  afterEach(() => {
    Object.defineProperty(db, 'pendingOrders', {
      value: originalTable,
      configurable: true,
      writable: true,
    });
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('queue', () => {
    it('assigns sequential local ids for today and stores a pending order', async () => {
      const service = await create();

      const first = await service.queue(command('1'), cart, 'Ana');
      const second = await service.queue(command('2'), cart, null);

      expect(first).toBe(`OFF-${today()}-001`);
      expect(second).toBe(`OFF-${today()}-002`);
      expect(service.pendingOrders()).toHaveLength(2);
      expect(service.pendingOrders()[0]).toMatchObject({
        localId: first,
        customerName: 'Ana',
        status: 'pending',
        retryCount: 0,
        errorMessage: null,
      });
      expect(JSON.parse(localStorage.getItem('wtf-offline-counter')!)).toEqual({
        date: today(),
        counter: 2,
      });
    });

    it('continues numbering after existing orders for today', async () => {
      const service = await create([{ localId: `OFF-${today()}-007` }]);

      expect(await service.queue(command(), cart, null)).toBe(`OFF-${today()}-008`);
    });

    it('continues numbering from the saved counter even if the orders were synced', async () => {
      localStorage.setItem(
        'wtf-offline-counter',
        JSON.stringify({ date: today(), counter: 12 }),
      );
      const service = await create();

      expect(await service.queue(command(), cart, null)).toBe(`OFF-${today()}-013`);
    });

    it('restarts numbering when the saved counter is from another day', async () => {
      localStorage.setItem('wtf-offline-counter', JSON.stringify({ date: '200101', counter: 50 }));
      const service = await create([{ localId: 'OFF-200101-050' }]);

      expect(await service.queue(command(), cart, null)).toBe(`OFF-${today()}-001`);
    });

    it('ignores a corrupt saved counter', async () => {
      localStorage.setItem('wtf-offline-counter', '{broken');
      const service = await create();

      expect(await service.queue(command(), cart, null)).toBe(`OFF-${today()}-001`);
    });
  });

  describe('get / update / remove / count', () => {
    it('gets an order by local id', async () => {
      const service = await create([{ localId: 'OFF-a-001', customerName: 'Ana' }]);

      expect((await service.get('OFF-a-001'))?.customerName).toBe('Ana');
      expect(await service.get('nope')).toBeUndefined();
    });

    it('update replaces the payload and resets the failure state', async () => {
      const service = await create([
        { localId: 'OFF-a-001', status: 'failed', errorMessage: 'boom', customerName: 'Old' },
      ]);

      await service.update('OFF-a-001', command('new'), cart, 'New');

      expect(table.rows[0]).toMatchObject({
        command: command('new'),
        customerName: 'New',
        status: 'pending',
        errorMessage: null,
      });
      expect(service.pendingOrders()[0].customerName).toBe('New');
    });

    it('update is a no-op for unknown ids', async () => {
      const service = await create([{ localId: 'OFF-a-001' }]);

      await service.update('missing', command(), cart, 'X');

      expect(table.rows[0].customerName).toBeNull();
    });

    it('remove deletes the order and refreshes the list', async () => {
      const service = await create([{ localId: 'OFF-a-001' }, { localId: 'OFF-a-002' }]);

      await service.remove('OFF-a-001');

      expect(service.pendingOrders().map((o) => o.localId)).toEqual(['OFF-a-002']);
    });

    it('getPendingSyncCount counts stored orders', async () => {
      const service = await create([{ localId: 'a' }, { localId: 'b' }]);

      expect(await service.getPendingSyncCount()).toBe(2);
    });
  });

  describe('syncAll', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    it('does nothing when not authenticated', async () => {
      localStorage.removeItem('token');
      const service = await create([{ localId: 'a' }]);

      await service.syncAll();

      expect(createBatch).not.toHaveBeenCalled();
    });

    it('does nothing while an offline edit holds the sync lock', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);
      service.lockSyncForOfflineEdit('a');
      service.lockSyncForOfflineEdit('a');

      await service.syncAll();
      expect(createBatch).not.toHaveBeenCalled();

      service.unlockSyncForOfflineEdit('a');
      await service.syncAll();
      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    it('sends pending orders oldest-first, then deletes them and alerts', async () => {
      const service = await create([
        { localId: 'new', createdAt: '2025-01-02T00:00:00.000Z', command: command('new') },
        { localId: 'old', createdAt: '2025-01-01T00:00:00.000Z', command: command('old') },
      ]);
      online.set(true);

      await service.syncAll();

      const sent = createBatch.mock.calls[0][0] as { note: string; createdAt: string }[];
      expect(sent.map((c) => c.note)).toEqual(['old', 'new']);
      expect(sent[0].createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(table.rows).toHaveLength(0);
      expect(service.pendingOrders()).toEqual([]);
      expect(alerts.success).toHaveBeenCalledWith('2 offline orders synced successfully.');
      expect(alerts.warning).not.toHaveBeenCalled();
      expect(service.isSyncing()).toBe(false);
    });

    it('uses the singular in the success alert', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncAll();

      expect(alerts.success).toHaveBeenCalledWith('1 offline order synced successfully.');
    });

    it('splits work into batches of 5', async () => {
      const seed = Array.from({ length: 7 }, (_, i) => ({
        localId: `o${i}`,
        createdAt: `2025-01-01T00:00:0${i}.000Z`,
      }));
      const service = await create(seed);
      online.set(true);

      await service.syncAll();

      expect(createBatch).toHaveBeenCalledTimes(2);
      expect((createBatch.mock.calls[0][0] as unknown[]).length).toBe(5);
      expect((createBatch.mock.calls[1][0] as unknown[]).length).toBe(2);
    });

    it('does not resend an order that another sync is working on right now', async () => {
      const service = await create([{ localId: 'b' }]);
      online.set(true);
      // Marked syncing after startup: a sync is genuinely running for it.
      await table.add({
        localId: 'a',
        command: command(),
        cartSnapshot: cart,
        customerName: null,
        createdAt: new Date().toISOString(),
        status: 'syncing',
        retryCount: 0,
      });

      await service.syncAll();

      expect((createBatch.mock.calls[0][0] as unknown[]).length).toBe(1);
      expect(table.rows.map((r) => r.localId)).toEqual(['a']);
    });

    it('retries a failing batch up to 3 times with exponential backoff, then marks it failed', async () => {
      createBatch.mockImplementation(() => throwError(() => new Error('server down')));
      const service = await create([{ localId: 'a', retryCount: 1 }]);
      online.set(true);

      const done = service.syncAll();
      await vi.advanceTimersByTimeAsync(0);
      expect(createBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(createBatch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(createBatch).toHaveBeenCalledTimes(3);
      await done;

      expect(table.rows[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'server down',
        retryCount: 2,
      });
      expect(alerts.warning).toHaveBeenCalledWith(
        '1 order failed to sync. Check pending orders.',
      );
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('succeeds when a retry works', async () => {
      createBatch
        .mockImplementationOnce(() => throwError(() => new Error('blip')))
        .mockImplementation((batch: { offlineLocalId?: string }[]) => of(saved(batch)));
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      const done = service.syncAll();
      await vi.advanceTimersByTimeAsync(500);
      await done;

      expect(createBatch).toHaveBeenCalledTimes(2);
      expect(table.rows).toHaveLength(0);
      expect(alerts.success).toHaveBeenCalled();
    });

    it('reports both outcomes when one batch fails and another succeeds', async () => {
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) =>
        batch.length === 5 ? of(saved(batch)) : throwError(() => new Error('bad')),
      );
      const seed = Array.from({ length: 7 }, (_, i) => ({
        localId: `o${i}`,
        createdAt: `2025-01-01T00:00:0${i}.000Z`,
      }));
      const service = await create(seed);
      online.set(true);

      const done = service.syncAll();
      await vi.advanceTimersByTimeAsync(5000);
      await done;

      expect(alerts.success).toHaveBeenCalledWith('5 offline orders synced successfully.');
      expect(alerts.warning).toHaveBeenCalledWith(
        '2 orders failed to sync. Check pending orders.',
      );
    });

    it('stops between batches when connectivity is lost', async () => {
      const seed = Array.from({ length: 6 }, (_, i) => ({
        localId: `o${i}`,
        createdAt: `2025-01-01T00:00:0${i}.000Z`,
      }));
      const service = await create(seed);
      online.set(true);
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) => {
        online.set(false);
        return of(saved(batch));
      });

      await service.syncAll();

      expect(createBatch).toHaveBeenCalledTimes(1);
      expect(table.rows).toHaveLength(1);
    });

    it('ignores a second call while a sync is running', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      const first = service.syncAll();
      const second = service.syncAll();
      await Promise.all([first, second]);

      expect(createBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('the result the server gives for each order', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    const seed3 = [
      { localId: 'a', createdAt: '2025-01-01T00:00:01.000Z' },
      { localId: 'b', createdAt: '2025-01-01T00:00:02.000Z' },
      { localId: 'c', createdAt: '2025-01-01T00:00:03.000Z' },
    ];

    it('sends each order with its queue number plus this device, the same one every time', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncAll();
      const first = (createBatch.mock.calls[0][0] as { offlineLocalId: string }[])[0].offlineLocalId;

      expect(first).toMatch(/^a-[0-9a-f]{8}$/);
      expect(localStorage.getItem('wtf-device-id')).toBe(first.slice(2));
    });

    it('keeps only the order that failed, with its own message, and removes the ones that saved', async () => {
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) =>
        of(
          saved(batch).map((result, index) =>
            index === 1 ? { ...result, orderId: null, error: 'Latte is not sold here.' } : result,
          ),
        ),
      );
      const service = await create(seed3);
      online.set(true);

      await service.syncAll();

      expect(table.rows.map((r) => r.localId)).toEqual(['b']);
      expect(table.rows[0]).toMatchObject({
        status: 'failed',
        errorMessage: 'Latte is not sold here.',
        retryCount: 1,
      });
      expect(alerts.success).toHaveBeenCalledWith('2 offline orders synced successfully.');
      expect(alerts.warning).toHaveBeenCalledWith('1 order failed to sync. Check pending orders.');
    });

    it('removes an order the server held for review and tells the cashier', async () => {
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) => of(saved(batch, 6)));
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncAll();

      expect(table.rows).toEqual([]);
      expect(alerts.success).not.toHaveBeenCalled();
      expect(alerts.warning).toHaveBeenCalledWith(
        '1 order synced but is waiting for an Admin to review it: the price or the menu changed since the sale.',
      );
    });

    it('tells the cashier once when synced sales took an item below zero', async () => {
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) =>
        of(
          saved(batch).map((result) => ({
            ...result,
            stockWarnings: ['Oat Milk is below zero: -200 ml. Count it and correct the stock.'],
          })),
        ),
      );
      const service = await create(seed3);
      online.set(true);

      await service.syncAll();

      expect(table.rows).toEqual([]);
      const stockAlerts = alerts.warning.mock.calls.filter((call) =>
        String(call[0]).startsWith('Stock after the synced sales'),
      );
      expect(stockAlerts.length).toBe(1);
      expect(stockAlerts[0][0]).toContain('Oat Milk is below zero');
    });

    it('counts saved and held orders separately', async () => {
      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) =>
        of(saved(batch).map((result, index) => (index === 0 ? { ...result, status: 6 } : result))),
      );
      const service = await create(seed3);
      online.set(true);

      await service.syncAll();

      expect(alerts.success).toHaveBeenCalledWith('2 offline orders synced successfully.');
      expect(alerts.warning).toHaveBeenCalledWith(
        '1 order synced but is waiting for an Admin to review it: the price or the menu changed since the sale.',
      );
    });

    it('fails an order the server sent no result for', async () => {
      createBatch.mockImplementation(() => of([]));
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncAll();

      expect(table.rows[0]).toMatchObject({
        status: 'failed',
        errorMessage: OfflineOrderService.NO_RESULT_MESSAGE,
      });
    });
  });

  describe('an interrupted sync', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    it('puts an order left syncing back to pending when the app starts, so it can be sent again', async () => {
      const service = await create([
        { localId: 'a', status: 'syncing', errorMessage: 'old error' },
        { localId: 'b', status: 'pending' },
        { localId: 'c', status: 'failed', errorMessage: 'nope' },
      ]);

      expect(table.rows.find((r) => r.localId === 'a')!.status).toBe('pending');
      expect(table.rows.find((r) => r.localId === 'b')!.status).toBe('pending');
      expect(table.rows.find((r) => r.localId === 'c')!.status).toBe('failed');
      expect(service.pendingOrders().find((o) => o.localId === 'a')!.status).toBe('pending');
    });

    it('sends the recovered order on the next sync', async () => {
      const service = await create([{ localId: 'a', status: 'syncing' }]);
      online.set(true);

      await service.syncAll();

      expect((createBatch.mock.calls[0][0] as unknown[]).length).toBe(1);
      expect(table.rows).toEqual([]);
    });

    it('leaves a healthy list alone', async () => {
      await create([{ localId: 'a' }, { localId: 'b', status: 'failed' }]);

      expect(table.rows.map((r) => r.status)).toEqual(['pending', 'failed']);
    });
  });

  describe('a server that never answers', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    it('gives up after the timeout and marks the order failed with a clear message', async () => {
      createBatch.mockImplementation(() => new Observable(() => undefined));
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      const done = service.syncAll();
      await vi.advanceTimersByTimeAsync(OfflineOrderService.SYNC_REQUEST_TIMEOUT_MS + 10);
      await done;

      expect(table.rows[0]).toMatchObject({
        status: 'failed',
        errorMessage: OfflineOrderService.TIMED_OUT_MESSAGE,
        retryCount: 1,
      });
      expect(service.isSyncing()).toBe(false);
    });

    it('does not ask again by itself after a timeout (Sync Now is safe: the server keeps one copy)', async () => {
      createBatch.mockImplementation(() => new Observable(() => undefined));
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      const done = service.syncAll();
      await vi.advanceTimersByTimeAsync(OfflineOrderService.SYNC_REQUEST_TIMEOUT_MS * 3);
      await done;

      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    it('can be synced again afterwards', async () => {
      createBatch.mockImplementationOnce(() => new Observable(() => undefined));
      const service = await create([{ localId: 'a' }]);
      online.set(true);
      let done = service.syncAll();
      await vi.advanceTimersByTimeAsync(OfflineOrderService.SYNC_REQUEST_TIMEOUT_MS + 10);
      await done;

      createBatch.mockImplementation((batch: { offlineLocalId?: string }[]) => of(saved(batch)));
      done = service.syncAll();
      await vi.advanceTimersByTimeAsync(0);
      await done;

      expect(table.rows).toEqual([]);
    });
  });

  describe('syncNow (the Sync Now button)', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    it('syncs when it can', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncNow();

      expect(createBatch).toHaveBeenCalledTimes(1);
      expect(alerts.warning).not.toHaveBeenCalled();
    });

    it('says so when offline instead of doing nothing', async () => {
      const service = await create([{ localId: 'a' }]);

      await service.syncNow();

      expect(createBatch).not.toHaveBeenCalled();
      expect(alerts.warning).toHaveBeenCalledWith(
        'You are offline. Orders will sync when the connection returns.',
      );
    });

    it('says so when the user has to sign in again', async () => {
      localStorage.removeItem('token');
      const service = await create([{ localId: 'a' }]);
      online.set(true);

      await service.syncNow();

      expect(createBatch).not.toHaveBeenCalled();
      expect(alerts.warning).toHaveBeenCalledWith('Please sign in again to sync your offline orders.');
    });

    it('says so when an offline order is open for editing', async () => {
      const service = await create([{ localId: 'a' }]);
      online.set(true);
      service.lockSyncForOfflineEdit('a');

      await service.syncNow();

      expect(createBatch).not.toHaveBeenCalled();
      expect(alerts.warning).toHaveBeenCalledWith('Close the offline order you are editing, then sync again.');
    });

    it('says so when a sync is already running, and does not start a second one', async () => {
      createBatch.mockImplementation(() => new Observable(() => undefined));
      const service = await create([{ localId: 'a' }]);
      online.set(true);
      const first = service.syncAll();
      await vi.advanceTimersByTimeAsync(10);

      await service.syncNow();

      expect(alerts.warning).toHaveBeenCalledWith('Orders are already syncing. Please wait a moment.');
      expect(createBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(OfflineOrderService.SYNC_REQUEST_TIMEOUT_MS + 10);
      await first;
    });

    it('retries an order that failed before', async () => {
      const service = await create([{ localId: 'a', status: 'failed', errorMessage: 'nope', retryCount: 2 }]);
      online.set(true);

      await service.syncNow();

      expect(createBatch).toHaveBeenCalledTimes(1);
      expect(table.rows).toEqual([]);
    });
  });

  describe('automatic sync', () => {
    beforeEach(() => localStorage.setItem('token', 'tok'));

    it('syncs on its own when the connection returns', async () => {
      await create([{ localId: 'a' }]);
      expect(createBatch).not.toHaveBeenCalled();

      online.set(true);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    it('does not auto-sync while logged out', async () => {
      localStorage.removeItem('token');
      await create([{ localId: 'a' }]);

      online.set(true);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(createBatch).not.toHaveBeenCalled();
    });
  });
});
