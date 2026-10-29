import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { AddOnLink } from '@api/products';
import { Item } from '@api/items';
import { OrderInput } from '@api/orders';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { Role } from '@data/users';
import { unique } from '@utils/unique';

export interface ItemFields {
  readonly name?: string;
  readonly unitName?: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly stockUnitName?: string | null;
  readonly unitsPerStockUnit?: number | null;
  readonly startingQuantity?: number;
  readonly costPrice?: number | null;
  readonly warningQuantity?: number | null;
  readonly criticalQuantity?: number | null;
  readonly allowNegativeStock?: boolean;
}

export interface FullItem extends Item {
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly unitName: string;
  readonly stockUnitName: string | null;
  readonly unitsPerStockUnit: number | null;
  readonly warningQuantity: number | null;
  readonly criticalQuantity: number | null;
  readonly productLinks: ReadonlyArray<{ productId: string; productName?: string; isActive: boolean; quantityPerSale: number }>;
}

export interface MovementRow {
  readonly movementType: string;
  readonly quantityDelta: number;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly notes: string | null;
  readonly productId: string | null;
}

export interface CoverageRow {
  readonly productId: string;
  readonly status: string;
  readonly missingOptions: readonly string[];
}

export interface StockLimits {
  readonly items: ReadonlyArray<{ id: string; name: string; unitName: string; balance: number }>;
  readonly links: ReadonlyArray<{ productId: string; itemId: string; quantityPerSale: number }>;
}

export interface SyncResult {
  readonly offlineLocalId: string;
  readonly orderId: string | null;
  readonly status: number | null;
  readonly reasons: readonly string[];
  readonly error: string | null;
  readonly stockWarnings: readonly string[] | null;
}

export interface NotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly subjectId: string | null;
  readonly isRead: boolean;
}

export class StockExtraApi {
  public constructor(private readonly api: ApiClient) {}

  public async createItemRaw(fields: ItemFields = {}, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', 'items', {
      body: {
        name: fields.name ?? unique('E2E Item'),
        unitName: fields.unitName ?? 'piece',
        sku: fields.sku ?? null,
        barcode: fields.barcode ?? null,
        stockUnitName: fields.stockUnitName ?? null,
        unitsPerStockUnit: fields.unitsPerStockUnit ?? null,
        startingQuantity: fields.startingQuantity ?? 10,
        costPrice: fields.costPrice ?? 5,
        warningQuantity: fields.warningQuantity ?? null,
        criticalQuantity: fields.criticalQuantity ?? null,
        allowNegativeStock: fields.allowNegativeStock ?? true,
      },
    });
  }

  public async fullItem(id: string): Promise<FullItem> {
    return this.api.json<FullItem>('superadmin', 'GET', `items/${id}`);
  }

  public async updateRaw(id: string, changes: Record<string, unknown>, role: Role = 'superadmin'): Promise<APIResponse> {
    const current = await this.api.json<Record<string, unknown>>('superadmin', 'GET', `items/${id}`);
    return this.api.call(role, 'PUT', `items/${id}`, { body: { ...current, ...changes, id } });
  }

  public async deleteRaw(id: string): Promise<APIResponse> {
    return this.api.call('superadmin', 'DELETE', `items/${id}`);
  }

  public async stockInRaw(id: string, quantity: number, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `items/${id}/stock`, { body: { itemId: id, quantity, notes: 'e2e' } });
  }

  public async adjustRaw(id: string, body: Record<string, unknown>, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `items/${id}/stock/adjust`, { body: { itemId: id, ...body } });
  }

  public async movementRows(id: string): Promise<readonly MovementRow[]> {
    const page = await this.api.json<{ items: MovementRow[] }>('superadmin', 'GET', `items/${id}/movements?page=1&pageSize=100`);
    return page.items;
  }

  public async coverageOf(productId: string, role: Role = 'superadmin'): Promise<CoverageRow | undefined> {
    const coverage = await this.api.json<{ products: CoverageRow[] }>(role, 'GET', 'items/coverage');
    return coverage.products.find((row) => row.productId === productId);
  }

  public async stockLimits(role: Role = 'cashier'): Promise<StockLimits> {
    return this.api.json<StockLimits>(role, 'GET', 'pos/stock-limits');
  }

  public async orderBodyWithId(id: string, input: OrderInput, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const status = input.status ?? OrderStatus.Completed;
    const completed = status === OrderStatus.Completed;
    return {
      id,
      customerId: input.customerId ?? null,
      items: input.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        addOns: (line.addOns ?? []).map((addOn) => ({ ...addOn, addOns: [], specialInstructions: null, bundlePromotionId: null })),
        specialInstructions: null,
        bundlePromotionId: null,
      })),
      bundlePromotions: [],
      status,
      paymentMethod: completed ? (input.paymentMethod ?? PaymentMethod.Cash) : null,
      amountReceived: completed ? (input.amountReceived ?? 100000) : null,
      tips: null,
      ...extra,
    };
  }

  public async updateOrderRaw(id: string, input: OrderInput, role: Role = 'cashier'): Promise<APIResponse> {
    return this.api.call(role, 'PUT', `orders/${id}`, { body: await this.orderBodyWithId(id, input) });
  }

  public async overrideOrderRaw(id: string, input: OrderInput, reason: string, role: Role = 'admin'): Promise<APIResponse> {
    return this.api.call(role, 'PUT', `orders/${id}/override`, {
      body: await this.orderBodyWithId(id, input, { overrideReason: reason }),
    });
  }

  public async syncOffline(
    orders: ReadonlyArray<{ body: Record<string, unknown>; localId: string }>,
    role: Role = 'cashier',
  ): Promise<readonly SyncResult[]> {
    const payload = orders.map((order) => ({ ...order.body, offlineLocalId: order.localId, createdAt: new Date().toISOString() }));
    return this.api.json<SyncResult[]>(role, 'POST', 'orders/sync', { orders: payload });
  }

  public async notifications(role: Role = 'superadmin'): Promise<readonly NotificationRow[]> {
    const page = await this.api.json<{ items: NotificationRow[] }>(role, 'GET', 'notifications?pageSize=100');
    return page.items;
  }

  public async alertsFor(itemId: string, role: Role = 'superadmin'): Promise<readonly NotificationRow[]> {
    return (await this.notifications(role)).filter((row) => row.subjectId === itemId);
  }
}

// Links created through POST products/{id}/addons come back inactive on the throwaway database (the column default is
// missing there), and a second assignment reactivates them, so assign twice. Harmless on a database that does it right.
export async function linkAddOnsReliably(api: ApiClient, productId: string, addOns: readonly AddOnLink[]): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await api.json<unknown>('superadmin', 'POST', `products/${productId}/addons`, { productId, addOns });
  }
}
