import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { environment } from '@environments/environment.development';
import { AddOnGroupDto, CustomerDto, ProductDto } from '@shared/models';
import { firstValueFrom } from 'rxjs';
import { ConnectivityService } from './connectivity.service';
import { db } from './db';
import { ImageCacheService } from './image-cache.service';

interface PosCatalogDto {
  products: ProductDto[];
  addOnsByProductId: Record<string, AddOnGroupDto[]>;
  customers: CustomerDto[];
  syncedAt: string;
}

@Injectable({ providedIn: 'root' })
export class CatalogCacheService {
  private static readonly CATALOG_ROW_ID = 1;

  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly imageCache = inject(ImageCacheService);

  private readonly _products = signal<ProductDto[]>([]);
  public readonly products = this._products.asReadonly();

  private readonly _customers = signal<CustomerDto[]>([]);
  public readonly customers = this._customers.asReadonly();

  private readonly _addOnsByProductId = signal<Record<string, AddOnGroupDto[]>>({});

  private readonly _isLoading = signal(false);
  public readonly isLoading = this._isLoading.asReadonly();

  private readonly _isSyncing = signal(false);
  public readonly isSyncing = this._isSyncing.asReadonly();

  private loaded = false;

  public async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this._isLoading.set(true);

    try {
      if (this.connectivity.isOnline()) {
        await this.syncFromApi();
      } else {
        await this.loadFromCache();
      }
    } finally {
      this.loaded = true;
      this._isLoading.set(false);
    }
  }

  public async refresh(): Promise<void> {
    if (!this.connectivity.isOnline()) {
      return;
    }

    this._isSyncing.set(true);

    try {
      await this.syncFromApi();
    } finally {
      this._isSyncing.set(false);
    }
  }

  public getAddOnsForProduct(productId: string): AddOnGroupDto[] {
    return this._addOnsByProductId()[productId] ?? [];
  }

  private async syncFromApi(): Promise<void> {
    try {
      const catalog = await firstValueFrom(
        this.http.get<PosCatalogDto>(`${environment.apiUrl}/sync/pos-catalog`),
      );

      await db.catalog.put({
        id: CatalogCacheService.CATALOG_ROW_ID,
        products: catalog.products,
        addOnsByProductId: catalog.addOnsByProductId,
        customers: catalog.customers,
        syncedAt: catalog.syncedAt,
      });

      // Cache images in the background, then resolve URLs for in-memory signals
      await this.imageCache.cacheImages(
        catalog.products,
        catalog.addOnsByProductId,
        catalog.customers,
      );

      this._products.set(await this.imageCache.resolveProducts(catalog.products));
      this._customers.set(await this.imageCache.resolveCustomers(catalog.customers));
      this._addOnsByProductId.set(await this.imageCache.resolveAddOns(catalog.addOnsByProductId));
    } catch {
      // API call failed — fall back to cache
      await this.loadFromCache();
    }
  }

  private async loadFromCache(): Promise<void> {
    const cached = await db.catalog.get(CatalogCacheService.CATALOG_ROW_ID);

    if (cached) {
      this._products.set(await this.imageCache.resolveProducts(cached.products));
      this._customers.set(await this.imageCache.resolveCustomers(cached.customers));
      this._addOnsByProductId.set(await this.imageCache.resolveAddOns(cached.addOnsByProductId));
    }
  }
}
