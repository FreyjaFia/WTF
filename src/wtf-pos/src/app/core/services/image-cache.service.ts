import { Injectable } from '@angular/core';
import { AddOnGroupDto, CustomerDto, ProductDto } from '@shared/models';
import { CachedImage, db } from './db';

interface ValidatedImage extends CachedImage {
  etag?: string;
  lastModified?: string;
}

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private static readonly MAX_IMAGE_AGE_DAYS = 30;
  private static readonly MAX_IMAGE_COUNT = 2000;
  private static readonly REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

  private readonly blobUrlCache = new Map<string, string>();

  public async cacheImages(
    products: ProductDto[],
    addOnsByProductId: Record<string, AddOnGroupDto[]>,
    customers: CustomerDto[],
  ): Promise<void> {
    const urls = new Set<string>();

    for (const p of products) {
      if (p.imageUrl) {
        urls.add(p.imageUrl);
      }
    }

    for (const groups of Object.values(addOnsByProductId)) {
      for (const group of groups) {
        for (const option of group.options) {
          if (option.imageUrl) {
            urls.add(option.imageUrl);
          }
        }
      }
    }

    for (const c of customers) {
      if (c.imageUrl) {
        urls.add(c.imageUrl);
      }
    }

    const existing: ValidatedImage[] = await db.images.where('url').anyOf([...urls]).toArray();
    const existingByUrl = new Map(existing.map((image) => [image.url, image]));
    const downloads = [...urls].map((url) => this.downloadOrRevalidate(url, existingByUrl.get(url)));
    await Promise.allSettled(downloads);
    await this.cleanupOldCache();
  }

  public async cacheUrl(url: string): Promise<void> {
    const existing: ValidatedImage | undefined = await db.images.get(url);
    const changed = await this.downloadOrRevalidate(url, existing);

    if (changed) {
      await this.cleanupOldCache();
    }
  }

  public resolveUrlSync(remoteUrl: string | null | undefined): string | null {
    if (!remoteUrl) {
      return null;
    }

    return this.blobUrlCache.get(remoteUrl) ?? remoteUrl;
  }

  public async resolveUrl(remoteUrl: string | null | undefined): Promise<string | null> {
    if (!remoteUrl) {
      return null;
    }

    if (this.blobUrlCache.has(remoteUrl)) {
      return this.blobUrlCache.get(remoteUrl)!;
    }

    const cached = await db.images.get(remoteUrl);

    if (cached) {
      const blobUrl = URL.createObjectURL(cached.blob);
      this.blobUrlCache.set(remoteUrl, blobUrl);
      return blobUrl;
    }

    return remoteUrl;
  }

  public async resolveProducts(products: ProductDto[]): Promise<ProductDto[]> {
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        imageUrl: await this.resolveUrl(p.imageUrl),
      })),
    );
  }

  public async resolveAddOns(
    addOnsByProductId: Record<string, AddOnGroupDto[]>,
  ): Promise<Record<string, AddOnGroupDto[]>> {
    const resolved: Record<string, AddOnGroupDto[]> = {};

    for (const [productId, groups] of Object.entries(addOnsByProductId)) {
      resolved[productId] = await Promise.all(
        groups.map(async (group) => ({
          ...group,
          options: await Promise.all(
            group.options.map(async (option) => ({
              ...option,
              imageUrl: await this.resolveUrl(option.imageUrl),
            })),
          ),
        })),
      );
    }

    return resolved;
  }

  public async resolveCustomers(customers: CustomerDto[]): Promise<CustomerDto[]> {
    return Promise.all(
      customers.map(async (c) => ({
        ...c,
        imageUrl: await this.resolveUrl(c.imageUrl),
      })),
    );
  }

  private async downloadOrRevalidate(url: string, existing: ValidatedImage | undefined): Promise<boolean> {
    if (!existing) {
      return this.fetchAndStore(url);
    }

    const cachedAtMs = existing.cachedAt ? new Date(existing.cachedAt).getTime() : 0;

    if (Date.now() - cachedAtMs < ImageCacheService.REVALIDATE_AFTER_MS) {
      return false;
    }

    return this.fetchAndStore(url, existing);
  }

  private async fetchAndStore(url: string, existing?: ValidatedImage): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};

      if (existing?.etag) {
        headers['If-None-Match'] = existing.etag;
      }

      if (existing?.lastModified) {
        headers['If-Modified-Since'] = existing.lastModified;
      }

      const response = await fetch(url, { headers });

      if (response.status === 304 && existing) {
        await db.images.put({ ...existing, cachedAt: new Date().toISOString() });
        return false;
      }

      if (!response.ok) {
        return false;
      }

      const blob = await response.blob();
      const stored: ValidatedImage = {
        url,
        blob,
        cachedAt: new Date().toISOString(),
        etag: response.headers?.get('ETag') ?? undefined,
        lastModified: response.headers?.get('Last-Modified') ?? undefined,
      };
      await db.images.put(stored);
      this.releaseBlobUrl(url);

      return true;
    } catch {
      // Offline or failing: keep serving whatever is cached
      return false;
    }
  }

  private releaseBlobUrl(url: string): void {
    const blobUrl = this.blobUrlCache.get(url);

    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.blobUrlCache.delete(url);
    }
  }

  public async cleanupOldCache(): Promise<void> {
    const allImages = await db.images.toArray();

    if (allImages.length === 0) {
      return;
    }

    const cutoffMs =
      Date.now() - ImageCacheService.MAX_IMAGE_AGE_DAYS * 24 * 60 * 60 * 1000;
    const toRemove = new Set<string>();

    for (const image of allImages) {
      const cachedAtMs = image.cachedAt ? new Date(image.cachedAt).getTime() : 0;

      if (!cachedAtMs || cachedAtMs < cutoffMs) {
        toRemove.add(image.url);
      }
    }

    const remaining = allImages
      .filter((image) => !toRemove.has(image.url))
      .sort((a, b) => {
        const aTime = a.cachedAt ? new Date(a.cachedAt).getTime() : 0;
        const bTime = b.cachedAt ? new Date(b.cachedAt).getTime() : 0;
        return aTime - bTime;
      });

    const overflow = remaining.length - ImageCacheService.MAX_IMAGE_COUNT;

    if (overflow > 0) {
      for (let i = 0; i < overflow; i++) {
        toRemove.add(remaining[i].url);
      }
    }

    if (toRemove.size === 0) {
      return;
    }

    const urls = [...toRemove];
    await db.images.bulkDelete(urls);

    for (const url of urls) {
      this.releaseBlobUrl(url);
    }
  }
}
