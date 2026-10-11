import { TestBed } from '@angular/core/testing';
import { AddOnGroupDto, CustomerDto, ProductDto } from '@shared/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedImage, db } from './db';
import { ImageCacheService } from './image-cache.service';

/** Minimal in-memory stand-in for the Dexie `images` table. */
class FakeImages {
  public rows = new Map<string, CachedImage>();

  public get(url: string): Promise<CachedImage | undefined> {
    return Promise.resolve(this.rows.get(url));
  }

  public put(image: CachedImage): Promise<string> {
    this.rows.set(image.url, image);
    return Promise.resolve(image.url);
  }

  public toArray(): Promise<CachedImage[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public bulkDelete(urls: string[]): Promise<void> {
    urls.forEach((u) => this.rows.delete(u));
    return Promise.resolve();
  }

  public where(_field: string) {
    return {
      anyOf: (urls: string[]) => ({
        primaryKeys: () => Promise.resolve(urls.filter((u) => this.rows.has(u))),
      }),
    };
  }
}

const product = (imageUrl: string | null): ProductDto => ({ id: imageUrl ?? 'x', imageUrl }) as never;
const customer = (imageUrl: string | null): CustomerDto => ({ id: imageUrl ?? 'c', imageUrl }) as never;
const addOns = (...urls: (string | null)[]): Record<string, AddOnGroupDto[]> => ({
  p1: [{ options: urls.map((imageUrl) => ({ imageUrl })) } as never],
});

const day = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('ImageCacheService', () => {
  const originalImages = db.images;
  let images: FakeImages;
  let service: ImageCacheService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    images = new FakeImages();
    Object.defineProperty(db, 'images', { value: images, configurable: true, writable: true });
    fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: !url.includes('bad'), blob: () => Promise.resolve(new Blob([url])) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++counter}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    service = TestBed.inject(ImageCacheService);
  });

  afterEach(() => {
    Object.defineProperty(db, 'images', {
      value: originalImages,
      configurable: true,
      writable: true,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('cacheImages', () => {
    it('downloads each distinct product, add-on and customer image once', async () => {
      await service.cacheImages(
        [product('a.png'), product('a.png'), product(null)],
        addOns('b.png', null),
        [customer('c.png')],
      );

      expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(['a.png', 'b.png', 'c.png']);
      expect([...images.rows.keys()].sort()).toEqual(['a.png', 'b.png', 'c.png']);
    });

    it('skips images that are already cached', async () => {
      await images.put({ url: 'a.png', blob: new Blob(), cachedAt: iso(0) });

      await service.cacheImages([product('a.png'), product('n.png')], {}, []);

      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['n.png']);
    });

    it('does not store failed or throwing downloads and never rejects', async () => {
      fetchMock.mockImplementation((url: string) =>
        url === 'boom.png' ? Promise.reject(new Error('net')) : Promise.resolve({ ok: false }),
      );

      await expect(
        service.cacheImages([product('bad.png'), product('boom.png')], {}, []),
      ).resolves.toBeUndefined();

      expect(images.rows.size).toBe(0);
    });
  });

  describe('cacheUrl', () => {
    it('downloads a missing url and ignores an already cached one', async () => {
      await service.cacheUrl('x.png');
      await service.cacheUrl('x.png');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(images.rows.has('x.png')).toBe(true);
    });
  });

  describe('resolving urls', () => {
    it.each([null, undefined, ''])('resolveUrlSync(%j) is null', (value) => {
      expect(service.resolveUrlSync(value)).toBeNull();
    });

    it('resolveUrlSync returns the remote url until a blob is known', async () => {
      expect(service.resolveUrlSync('a.png')).toBe('a.png');

      await images.put({ url: 'a.png', blob: new Blob(['x']), cachedAt: iso(0) });
      const resolved = await service.resolveUrl('a.png');

      expect(service.resolveUrlSync('a.png')).toBe(resolved);
    });

    it('resolveUrl returns null for empty values and the remote url for uncached ones', async () => {
      expect(await service.resolveUrl(null)).toBeNull();
      expect(await service.resolveUrl('')).toBeNull();
      expect(await service.resolveUrl('remote.png')).toBe('remote.png');
    });

    it('resolveUrl creates one blob url per cached image and reuses it', async () => {
      await images.put({ url: 'a.png', blob: new Blob(['x']), cachedAt: iso(0) });

      const first = await service.resolveUrl('a.png');
      const second = await service.resolveUrl('a.png');

      expect(first).toBe('blob:1');
      expect(second).toBe('blob:1');
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it('resolves product, customer and add-on image urls', async () => {
      await images.put({ url: 'a.png', blob: new Blob(), cachedAt: iso(0) });
      await images.put({ url: 'b.png', blob: new Blob(), cachedAt: iso(0) });

      const products = await service.resolveProducts([product('a.png'), product('z.png'), product(null)]);
      const customers = await service.resolveCustomers([customer('b.png')]);
      const resolvedAddOns = await service.resolveAddOns(addOns('a.png', 'z.png', null));

      expect(products.map((p) => p.imageUrl)).toEqual(['blob:1', 'z.png', null]);
      expect(customers[0].imageUrl).toBe('blob:2');
      expect(resolvedAddOns['p1'][0].options.map((o) => o.imageUrl)).toEqual(['blob:1', 'z.png', null]);
    });
  });

  describe('cleanupOldCache', () => {
    it('does nothing when the cache is empty', async () => {
      await service.cleanupOldCache();

      expect(images.rows.size).toBe(0);
    });

    it('removes images older than 30 days or without a timestamp, keeps recent ones', async () => {
      await images.put({ url: 'fresh', blob: new Blob(), cachedAt: iso(-29 * day) });
      await images.put({ url: 'old', blob: new Blob(), cachedAt: iso(-31 * day) });
      await images.put({ url: 'undated', blob: new Blob(), cachedAt: '' });

      await service.cleanupOldCache();

      expect([...images.rows.keys()]).toEqual(['fresh']);
    });

    it('revokes blob urls of removed images', async () => {
      await images.put({ url: 'old', blob: new Blob(), cachedAt: iso(-40 * day) });
      const blobUrl = await service.resolveUrl('old');

      await service.cleanupOldCache();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
      expect(service.resolveUrlSync('old')).toBe('old');
    });

    it('keeps at most 2000 images, dropping the oldest', async () => {
      for (let i = 0; i < 2003; i++) {
        await images.put({ url: `img${i}`, blob: new Blob(), cachedAt: iso(-i * 1000) });
      }

      await service.cleanupOldCache();

      expect(images.rows.size).toBe(2000);
      // img0 is the newest; img2002/2001/2000 are the oldest.
      expect(images.rows.has('img0')).toBe(true);
      expect(images.rows.has('img2000')).toBe(false);
      expect(images.rows.has('img2002')).toBe(false);
    });
  });
});
