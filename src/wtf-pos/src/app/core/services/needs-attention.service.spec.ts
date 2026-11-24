import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import { announceLocalDataWiped } from './local-data-events';
import { NeedsAttentionService } from './needs-attention.service';
import { OrderService } from './order.service';
import { UnsyncedOrderService } from './unsynced-order.service';

describe('NeedsAttentionService', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let getOrdersPaged: ReturnType<typeof vi.fn>;
  let getUnsyncedOrders: ReturnType<typeof vi.fn>;
  let canWrite: boolean;
  let canOverride: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    online = signal(true);
    canWrite = true;
    canOverride = true;
    getOrdersPaged = vi.fn((query: { status: number }) => of({ totalCount: query.status === 5 ? 2 : 3 }));
    getUnsyncedOrders = vi.fn(() => of({ totalCount: 4 }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectivityService, useValue: { isOnline: online } },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            canWriteOrders: () => canWrite,
            canOverrideOrders: () => canOverride,
          },
        },
        { provide: OrderService, useValue: { getOrdersPaged } },
        { provide: UnsyncedOrderService, useValue: { getUnsyncedOrders } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds up what is waiting, for someone who can answer all three kinds', () => {
    const service = TestBed.inject(NeedsAttentionService);

    service.refresh();

    expect(service.total()).toBe(service.awaiting() + service.held() + service.unsynced());
    expect(service.unsynced()).toBe(4);
    expect(service.total()).toBeGreaterThan(4);
  });

  it('asks only for what the person may act on', () => {
    canOverride = false;
    const service = TestBed.inject(NeedsAttentionService);

    service.refresh();

    expect(getUnsyncedOrders).not.toHaveBeenCalled();
    expect(getOrdersPaged).toHaveBeenCalledTimes(1);
    expect(service.unsynced()).toBe(0);
    expect(service.held()).toBe(0);
  });

  it('does not ask while offline', () => {
    online.set(false);
    const service = TestBed.inject(NeedsAttentionService);

    service.refresh();

    expect(getOrdersPaged).not.toHaveBeenCalled();
  });

  it('forgets the counts when the device stops belonging to the person who was signed in', () => {
    const service = TestBed.inject(NeedsAttentionService);
    service.refresh();
    expect(service.total()).toBeGreaterThan(0);

    announceLocalDataWiped();

    expect(service.total()).toBe(0);
  });

  it('asks again every minute while something is listening, and stops when the last one leaves', async () => {
    const service = TestBed.inject(NeedsAttentionService);
    service.start();
    service.start();
    const first = getOrdersPaged.mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getOrdersPaged.mock.calls.length).toBeGreaterThan(first);

    service.stop();
    service.stop();
    const stopped = getOrdersPaged.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getOrdersPaged.mock.calls.length).toBe(stopped);
  });
});
