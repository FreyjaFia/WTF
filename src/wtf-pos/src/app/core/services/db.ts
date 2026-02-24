import { CartItemDto } from '@shared/models';
import type {
  AddOnGroupDto,
  CreateOrderCommand,
  CustomerDto,
  ProductDto,
} from '@shared/models';
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
  cachedAt: string;
}

export interface PendingOrder {
  id?: number;
  localId: string;
  command: CreateOrderCommand;
  cartSnapshot: CartItemDto[];
  customerName: string | null;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  errorMessage?: string | null;
  retryCount: number;
}

export class WtfDatabase extends Dexie {
  public readonly carts!: Table<PersistedCart, number>;
  public readonly catalog!: Table<CachedCatalog, number>;
  public readonly images!: Table<CachedImage, string>;
  public readonly pendingOrders!: Table<PendingOrder, number>;

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

    this.version(4).stores({
      carts: '++id',
      catalog: '++id',
      images: 'url',
      pendingOrders: '++id, localId, status',
    });

    this.version(5).stores({
      carts: '++id',
      catalog: '++id',
      images: 'url, cachedAt',
      pendingOrders: '++id, localId, status',
    });
  }
}

export const db = new WtfDatabase();
