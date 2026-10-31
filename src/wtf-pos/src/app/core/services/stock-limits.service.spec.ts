import { environment } from '@environments/environment.development';
import { PosStockLimitsDto } from '@shared/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, failNetwork, setupHttpService } from '../../testing/service-testing';
import { ConnectivityService } from './connectivity.service';
import { StockLimitsService } from './stock-limits.service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StockLimitsService', () => {
  const url = `${environment.apiUrl}/pos/stock-limits`;
  const data = (): PosStockLimitsDto => ({
    items: [{ id: 'cup', name: 'Cup', unitName: 'pc', balance: 1 }],
    links: [{ productId: 'mocha', itemId: 'cup', quantityPerSale: 1 }],
    sizeMultipliers: [{ productId: 'large', multiplier: 1.5 }],
    sizeAmounts: [{ productId: 'latte', sizeProductId: 'large', itemId: 'cup', quantity: 2 }],
    asOf: '2026-10-26T10:00:00Z',
  });

  it('starts empty, with nothing that blocks', () => {
    const { service } = setupHttpService(StockLimitsService);

    expect(service.items()).toEqual([]);
    expect(service.links()).toEqual([]);
    expect(service.sizeMultipliers()).toEqual([]);
    expect(service.sizeAmounts()).toEqual([]);
    expect(service.asOf()).toBeNull();
    expect(service.hasBlockingItems()).toBe(false);
  });

  it('keeps the items, the links and the time the shop answered', () => {
    const { service, http } = setupHttpService(StockLimitsService);
    const result = capture(service.load());
    http.expectOne(url).flush(data());

    expect(result.error).toBeUndefined();
    expect(service.items().map((i) => i.name)).toEqual(['Cup']);
    expect(service.links()).toHaveLength(1);
    expect(service.sizeMultipliers()).toEqual([{ productId: 'large', multiplier: 1.5 }]);
    expect(service.sizeAmounts()).toHaveLength(1);
    expect(service.asOf()).toBe('2026-10-26T10:00:00Z');
    expect(service.hasBlockingItems()).toBe(true);
  });

  it('keeps the last answer when a quiet refresh fails', () => {
    const { service, http } = setupHttpService(StockLimitsService);
    capture(service.load());
    http.expectOne(url).flush(data());

    service.refresh();
    failNetwork(http.expectOne(url));

    expect(service.items()).toHaveLength(1);
  });

  it('loads when started and again every minute while online, and stops when the last user leaves', () => {
    vi.useFakeTimers();
    let online = true;
    const { service, http } = setupHttpService(StockLimitsService, [
      { provide: ConnectivityService, useValue: { isOnline: () => online, checkNow: vi.fn() } },
    ]);

    service.start();
    service.start();
    http.expectOne(url).flush(data());

    vi.advanceTimersByTime(60_000);
    http.expectOne(url).flush(data());

    online = false;
    vi.advanceTimersByTime(60_000);
    http.expectNone(url);

    online = true;

    service.stop();
    vi.advanceTimersByTime(60_000);
    http.expectOne(url).flush(data());

    service.stop();
    vi.advanceTimersByTime(120_000);
    http.expectNone(url);
  });
});
