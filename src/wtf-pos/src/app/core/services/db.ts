import { CartItemDto } from '@shared/models';
import type {
  AddOnGroupDto,
  CatalogLookupsDto,
  PosShopSettingsDto,
  CreateOrderCommand,
  CustomerDto,
  DiscountedProductPromotionDto,
  FixedBundlePromotionDto,
  MixMatchPromotionDto,
  PromotionListItemDto,
  ProductDto,
  SeniorPwdPersonRequestDto,
} from '@shared/models';
import Dexie, { type Table } from 'dexie';

export interface PersistedCart {
  id: number;
  customerId: string | null;
  customerAddress?: string | null;
  specialInstructions: string;
  items: CartItemDto[];
  seniorPwdPersons?: SeniorPwdPersonRequestDto[];
  // The branch the cart was made in: another branch can sell other products at other prices. Missing: saved before branches.
  branchId?: string | null;
  savedAt: string;
}

export interface CachedCatalog {
  id: number;
  products: ProductDto[];
  addOnsByProductId: Record<string, AddOnGroupDto[]>;
  customers: CustomerDto[];
  bundlePromotions: PromotionListItemDto[];
  discountedPromotions?: DiscountedProductPromotionDto[];
  fixedBundles?: FixedBundlePromotionDto[];
  mixMatchPromotions?: MixMatchPromotionDto[];
  lookups?: CatalogLookupsDto;
  settings?: PosShopSettingsDto;
  // The branch whose prices this catalog holds (a branch can price a product on its own). Missing: saved before branches.
  branchId?: string | null;
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
  // The shop the sale was made for: a queued order is only ever sent with that shop's login. None means the first shop.
  tenantId?: string;
  // The person who made the sale: only they send, change or discard it. None (queued by an older app) means anyone of the shop.
  userId?: string;
  // The branch the sale was made in. Empty means the order is not tied to one (a shop with one branch, or sold under All branches).
  branchId?: string | null;
  command: CreateOrderCommand;
  cartSnapshot: CartItemDto[];
  // The snapshot holds list prices (the editor applies promotions again when it reopens the cart), so the total with
  // promotions is kept here.
  previewTotal?: number | null;
  customerName: string | null;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  errorMessage?: string | null;
  retryCount: number;
  /** 2 once the command can carry Senior / PWD persons. 3 once it also carries the catalog sync time. */
  version?: number;
}

export type SyncOutcome = 'saved' | 'saved-with-note' | 'sent-for-review' | 'could-not-sync';

export interface SyncResultEntry {
  id?: number;
  localId: string;
  tenantId?: string;
  userId?: string;
  orderNumber: number | null;
  outcome: SyncOutcome;
  message: string;
  reasons: string[];
  at: string;
}

export class WtfDatabase extends Dexie {
  public readonly carts!: Table<PersistedCart, number>;
  public readonly catalog!: Table<CachedCatalog, number>;
  public readonly images!: Table<CachedImage, string>;
  public readonly pendingOrders!: Table<PendingOrder, number>;
  public readonly syncResults!: Table<SyncResultEntry, number>;

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

    this.version(6).stores({
      carts: '++id',
      catalog: '++id',
      images: 'url, cachedAt',
      pendingOrders: '++id, localId, status',
      syncResults: '++id, localId, tenantId, at',
    });
  }
}

export const db = new WtfDatabase();
