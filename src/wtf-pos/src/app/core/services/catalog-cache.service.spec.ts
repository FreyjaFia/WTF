import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment.development';
import { ProductDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogCacheService } from './catalog-cache.service';
import { ConnectivityService } from './connectivity.service';
import { CachedCatalog, db } from './db';
import { ImageCacheService } from './image-cache.service';

const api = environment.apiUrl;
const prod = (id: string, price: number, name = id): ProductDto => ({ id, price, name }) as never;

describe('CatalogCacheService', () => {
  const originalCatalog = db.catalog;
  let stored: CachedCatalog | undefined;
  let online: ReturnType<typeof signal<boolean>>;
  let http: HttpTestingController;
  let imageCache: {
    cacheImages: ReturnType<typeof vi.fn>;
    resolveProducts: ReturnType<typeof vi.fn>;
    resolveCustomers: ReturnType<typeof vi.fn>;
    resolveAddOns: ReturnType<typeof vi.fn>;
  };

  const settle = () => vi.advanceTimersByTimeAsync(0);

  function create(): CatalogCacheService {
    return TestBed.inject(CatalogCacheService);
  }

  /** Answers the three catalog requests with the given data. */
  async function answerSync(options: {
    products?: ProductDto[];
    customers?: unknown[];
    addOns?: Record<string, unknown[]>;
    fixed?: unknown[] | 'fail';
    mix?: unknown[] | 'fail';
    discounted?: unknown[];
    catalogFails?: boolean;
  } = {}): Promise<void> {
    await settle();
    const catalog = http.expectOne(`${api}/sync/pos-catalog`);
    const fixed = http.expectOne(`${api}/management/promotions/fixed-bundles`);
    const mix = http.expectOne(`${api}/management/promotions/mix-match`);
    const discounted = http.expectOne(`${api}/pos/promotions/discounted-products`);

    if (options.catalogFails) {
      catalog.flush('x', { status: 500, statusText: 'err' });
    } else {
      catalog.flush({
        products: options.products ?? [],
        customers: options.customers ?? [],
        addOnsByProductId: options.addOns ?? {},
        syncedAt: '2025-01-01T00:00:00Z',
      });
    }
    if (options.fixed === 'fail') {
      fixed.flush('x', { status: 500, statusText: 'err' });
    } else {
      fixed.flush(options.fixed ?? []);
    }
    if (options.mix === 'fail') {
      mix.flush('x', { status: 500, statusText: 'err' });
    } else {
      mix.flush(options.mix ?? []);
    }
    discounted.flush(options.discounted ?? []);
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stored = undefined;
    online = signal(true);
    Object.defineProperty(db, 'catalog', {
      configurable: true,
      writable: true,
      value: {
        get: vi.fn(() => Promise.resolve(stored)),
        put: vi.fn((row: CachedCatalog) => {
          stored = row;
          return Promise.resolve(1);
        }),
      },
    });
    imageCache = {
      cacheImages: vi.fn(() => Promise.resolve()),
      resolveProducts: vi.fn((p: unknown) => Promise.resolve(p)),
      resolveCustomers: vi.fn((c: unknown) => Promise.resolve(c)),
      resolveAddOns: vi.fn((a: unknown) => Promise.resolve(a)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConnectivityService, useValue: { isOnline: online } },
        { provide: ImageCacheService, useValue: imageCache },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    Object.defineProperty(db, 'catalog', {
      value: originalCatalog,
      configurable: true,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('load', () => {
    it('syncs from the API when online and fills the signals', async () => {
      const service = create();
      const done = service.load();
      expect(service.isLoading()).toBe(true);

      await answerSync({
        products: [prod('p1', 10)],
        customers: [{ id: 'c1' }],
        addOns: { p1: [{ id: 'g' }] },
        fixed: [{ id: 'f1' }],
        mix: [{ id: 'm1' }],
      });
      await done;

      expect(service.isLoading()).toBe(false);
      expect(service.products()).toEqual([prod('p1', 10)]);
      expect(service.customers()).toEqual([{ id: 'c1' }]);
      expect(service.getAddOnsForProduct('p1')).toEqual([{ id: 'g' }]);
      expect(service.getAddOnsForProduct('missing')).toEqual([]);
      expect(service.bundlePromotions()).toEqual([{ id: 'f1' }, { id: 'm1' }]);
      expect(stored?.bundlePromotions).toEqual([{ id: 'f1' }, { id: 'm1' }]);
      expect(imageCache.cacheImages).toHaveBeenCalled();
    });

    it('keeps the active discounts with the catalog, so they are there offline', async () => {
      const service = create();
      const done = service.load();

      await answerSync({ products: [prod('p1', 10)], discounted: [{ id: 'd1' }] });
      await done;

      expect(service.discountedPromotions()).toEqual([{ id: 'd1' }]);
      expect(stored?.discountedPromotions).toEqual([{ id: 'd1' }]);
    });

    it('reads the discounts back from the saved catalog when the API fails', async () => {
      stored = {
        id: 1,
        products: [prod('cached', 5)],
        customers: [],
        addOnsByProductId: {},
        bundlePromotions: [],
        discountedPromotions: [{ id: 'd9' }],
        syncedAt: 'x',
      } as never;
      const service = create();
      const done = service.load();

      await answerSync({ catalogFails: true });
      await done;

      expect(service.discountedPromotions()).toEqual([{ id: 'd9' }]);
    });

    it('has no discounts from a catalog saved before they were kept', async () => {
      stored = {
        id: 1,
        products: [prod('cached', 5)],
        customers: [],
        addOnsByProductId: {},
        bundlePromotions: [],
        syncedAt: 'x',
      } as never;
      const service = create();
      const done = service.load();

      await answerSync({ catalogFails: true });
      await done;

      expect(service.discountedPromotions()).toEqual([]);
    });

    it('still loads when one bundle-promotion request fails', async () => {
      const service = create();
      const done = service.load();

      await answerSync({ products: [prod('p1', 1)], fixed: 'fail', mix: [{ id: 'm1' }] });
      await done;

      expect(service.products()).toHaveLength(1);
      expect(service.bundlePromotions()).toEqual([{ id: 'm1' }]);
    });

    it('falls back to the cached catalog when the API fails', async () => {
      stored = {
        id: 1,
        products: [prod('cached', 5)],
        customers: [],
        addOnsByProductId: {},
        bundlePromotions: [{ id: 'b' }],
        syncedAt: 'x',
      } as never;
      const service = create();
      const done = service.load();

      await answerSync({ catalogFails: true });
      await done;

      expect(service.products().map((p) => p.id)).toEqual(['cached']);
      expect(service.bundlePromotions()).toEqual([{ id: 'b' }]);
    });

    it('loads from the cache without any HTTP call when offline', async () => {
      online.set(false);
      stored = {
        id: 1,
        products: [prod('cached', 5)],
        customers: [],
        addOnsByProductId: {},
        syncedAt: 'x',
      } as never;
      const service = create();

      await service.load();

      http.expectNone(`${api}/sync/pos-catalog`);
      expect(service.products().map((p) => p.id)).toEqual(['cached']);
      expect(service.bundlePromotions()).toEqual([]);
    });

    it('syncs right after loading when the connection came back while the cache was being read', async () => {
      online.set(false);
      // The first connection check finishes in the middle of reading the cache.
      (db.catalog as unknown as { get: ReturnType<typeof vi.fn> }).get.mockImplementation(() => {
        online.set(true);
        return Promise.resolve(stored);
      });
      const service = create();

      await service.load();
      TestBed.tick();

      await answerSync({ products: [prod('fresh', 1)] });
      expect(service.products().map((p) => p.id)).toEqual(['fresh']);
    });

    it('stays empty when offline with nothing cached', async () => {
      online.set(false);
      const service = create();

      await service.load();

      expect(service.products()).toEqual([]);
      expect(service.bundlePromotions()).toEqual([]);
    });

    it('only loads once', async () => {
      online.set(false);
      const service = create();
      await service.load();
      (db.catalog.get as unknown as ReturnType<typeof vi.fn>).mockClear();

      await service.load();

      expect(db.catalog.get).not.toHaveBeenCalled();
    });
  });

  describe('stale price detection', () => {
    const cachedWith = (...products: ProductDto[]): CachedCatalog =>
      ({ id: 1, products, customers: [], addOnsByProductId: {}, syncedAt: 'x' }) as never;

    it('reports products whose price changed since the last sync', async () => {
      stored = cachedWith(prod('a', 10, 'Latte'), prod('b', 20), prod('gone', 1));
      const service = create();
      const done = service.load();

      await answerSync({ products: [prod('a', 12, 'Latte'), prod('b', 20), prod('new', 3)] });
      await done;

      expect(service.hasStalePrices()).toBe(true);
      expect(service.stalePriceItems()).toEqual([
        { productId: 'a', productName: 'Latte', oldPrice: 10, newPrice: 12 },
      ]);
    });

    it('reports nothing on the very first sync', async () => {
      const service = create();
      const done = service.load();

      await answerSync({ products: [prod('a', 10)] });
      await done;

      expect(service.hasStalePrices()).toBe(false);
    });
  });

  describe('refresh', () => {
    it('does nothing while offline', async () => {
      online.set(false);
      const service = create();

      await service.refresh();

      http.expectNone(`${api}/sync/pos-catalog`);
    });

    it('sets isSyncing during the sync and ignores overlapping refreshes', async () => {
      const service = create();
      const first = service.refresh();
      expect(service.isSyncing()).toBe(true);
      const second = service.refresh();

      await answerSync({ products: [prod('a', 1)] });
      await Promise.all([first, second]);

      expect(service.isSyncing()).toBe(false);
      expect(service.products()).toHaveLength(1);
    });
  });

  describe('background refresh', () => {
    it('refreshes every 15 minutes once loaded and online', async () => {
      const service = create();
      const done = service.load();
      await answerSync();
      await done;

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      await answerSync({ products: [prod('z', 1)] });
      expect(service.products()).toHaveLength(1);
    });

    it('does not refresh before the first load', async () => {
      create();

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      http.expectNone(`${api}/sync/pos-catalog`);
    });

    it('refreshes when connectivity returns after load', async () => {
      online.set(false);
      const service = create();
      await service.load();
      TestBed.tick();

      online.set(true);
      TestBed.tick();

      await answerSync({ products: [prod('r', 1)] });
      expect(service.products()).toHaveLength(1);
    });
  });
});
