import { CartItemDto } from '@shared/models';
import type { AddOnGroupDto, CustomerDto, ProductDto } from '@shared/models';
import Dexie, { type Table } from 'dexie';

export interface PersistedCart {
  id: number;
  customerId: string | null;
  specialInstructions: string;
  items: CartItemDto[];
  savedAt: string;
}

export interface CachedCatalog {
  id: number;
  products: ProductDto[];
  addOnsByProductId: Record<string, AddOnGroupDto[]>;
  customers: CustomerDto[];
  syncedAt: string;
}

export interface CachedImage {
  url: string;
  blob: Blob;
}

export class WtfDatabase extends Dexie {
  public readonly carts!: Table<PersistedCart, number>;
  public readonly catalog!: Table<CachedCatalog, number>;
  public readonly images!: Table<CachedImage, string>;

  constructor() {
    super('wtf-pos');

    this.version(1).stores({
      carts: '++id',
    });

    this.version(2).stores({
      carts: '++id',
      catalog: '++id',
    });

    this.version(3).stores({
      carts: '++id',
      catalog: '++id',
      images: 'url',
    });
  }
}

export const db = new WtfDatabase();
