import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
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

interface StalePriceItem {
  productId: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogCacheService {
  private static readonly CATALOG_ROW_ID = 1;
  private static readonly REFRESH_INTERVAL_MS = 15 * 60 * 1000;

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

  private readonly _stalePriceItems = signal<StalePriceItem[]>([]);
  public readonly stalePriceItems = this._stalePriceItems.asReadonly();
  public readonly hasStalePrices = computed(() => this._stalePriceItems().length > 0);

  private loaded = false;
  private syncInProgress = false;

  constructor() {
    setInterval(() => {
      this.backgroundRefresh();
    }, CatalogCacheService.REFRESH_INTERVAL_MS);

    effect(() => {
      const isOnline = this.connectivity.isOnline();

      if (isOnline) {
        this.backgroundRefresh();
      }
    });
  }

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

    if (this.syncInProgress) {
      return;
    }

    this._isSyncing.set(true);
    this.syncInProgress = true;

    try {
      await this.syncFromApi();
    } finally {
      this.syncInProgress = false;
      this._isSyncing.set(false);
    }
  }

  public getAddOnsForProduct(productId: string): AddOnGroupDto[] {
    return this._addOnsByProductId()[productId] ?? [];
  }

  private async syncFromApi(): Promise<void> {
    try {
      const previousCatalog = await db.catalog.get(CatalogCacheService.CATALOG_ROW_ID);
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

      await this.imageCache.cacheImages(
        catalog.products,
        catalog.addOnsByProductId,
        catalog.customers,
      );

      this._products.set(await this.imageCache.resolveProducts(catalog.products));
      this._customers.set(await this.imageCache.resolveCustomers(catalog.customers));
      this._addOnsByProductId.set(await this.imageCache.resolveAddOns(catalog.addOnsByProductId));
      this.detectStalePrices(previousCatalog?.products ?? [], catalog.products);
    } catch {
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

  private backgroundRefresh(): void {
    if (!this.loaded || !this.connectivity.isOnline() || this.syncInProgress) {
      return;
    }

    void this.refresh();
  }

  private detectStalePrices(previous: ProductDto[], next: ProductDto[]): void {
    if (previous.length === 0) {
      this._stalePriceItems.set([]);
      return;
    }

    const previousById = new Map(previous.map((product) => [product.id, product]));
    const changed: StalePriceItem[] = [];

    for (const product of next) {
      const oldProduct = previousById.get(product.id);

      if (!oldProduct) {
        continue;
      }

      if (oldProduct.price !== product.price) {
        changed.push({
          productId: product.id,
          productName: product.name,
          oldPrice: oldProduct.price,
          newPrice: product.price,
        });
      }
    }

    this._stalePriceItems.set(changed);
  }
}
