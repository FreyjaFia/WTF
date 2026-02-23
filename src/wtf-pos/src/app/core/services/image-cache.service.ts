import { Injectable } from '@angular/core';
import { AddOnGroupDto, CustomerDto, ProductDto } from '@shared/models';
import { db } from './db';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
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

    const existing = await db.images.where('url').anyOf([...urls]).primaryKeys();
    const existingSet = new Set(existing);
    const toDownload = [...urls].filter((u) => !existingSet.has(u));

    const downloads = toDownload.map((url) => this.downloadAndStore(url));
    await Promise.allSettled(downloads);
  }

  public async cacheUrl(url: string): Promise<void> {
    const existing = await db.images.get(url);

    if (!existing) {
      await this.downloadAndStore(url);
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

  private async downloadAndStore(url: string): Promise<void> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return;
      }

      const blob = await response.blob();
      await db.images.put({ url, blob });
    } catch {
      // Silently skip failed image downloads
    }
  }
}
