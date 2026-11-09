import { ApiClient } from '@api/client';
import { Role } from '@data/users';
import { unique } from '@utils/unique';

export interface ItemInput {
  readonly name?: string;
  readonly unitName?: string;
  readonly startingQuantity?: number;
  readonly costPrice?: number | null;
  readonly warningQuantity?: number | null;
  readonly criticalQuantity?: number | null;
  readonly wasteApprovalLimit?: number | null;
  readonly allowNegativeStock?: boolean;
}

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly currentQuantity: number;
  readonly allowNegativeStock: boolean;
  readonly wasteApprovalLimit: number | null;
  readonly isActive: boolean;
}

export interface Movement {
  readonly movementType?: string;
  readonly type?: string;
  readonly quantityDelta?: number;
  readonly notes?: string | null;
}

export class ItemsApi {
  public constructor(private readonly api: ApiClient) {}

  public async create(input: ItemInput = {}, role: Role = 'owner'): Promise<Item> {
    const body = {
      name: input.name ?? unique('E2E Item'),
      unitName: input.unitName ?? 'piece',
      sku: null,
      startingQuantity: input.startingQuantity ?? 100,
      costPrice: input.costPrice ?? 5,
      warningQuantity: input.warningQuantity ?? null,
      criticalQuantity: input.criticalQuantity ?? null,
      wasteApprovalLimit: input.wasteApprovalLimit ?? null,
      allowNegativeStock: input.allowNegativeStock ?? true,
    };
    return this.api.json<Item>(role, 'POST', 'items', body);
  }

  public async get(id: string, role: Role = 'owner'): Promise<Item> {
    return this.api.json<Item>(role, 'GET', `items/${id}`);
  }

  public async balance(id: string): Promise<number> {
    return (await this.get(id)).currentQuantity;
  }

  public async update(id: string, changes: Partial<ItemInput>): Promise<Item> {
    const current = await this.api.json<Record<string, unknown>>('owner', 'GET', `items/${id}`);
    return this.api.json<Item>('owner', 'PUT', `items/${id}`, { ...current, ...changes, id });
  }

  public async stockIn(id: string, quantity: number, role: Role = 'owner'): Promise<void> {
    await this.api.json<unknown>(role, 'POST', `items/${id}/stock`, { itemId: id, quantity, notes: 'e2e stock in' });
  }

  public async remove(id: string): Promise<void> {
    await this.api.json<unknown>('owner', 'DELETE', `items/${id}`);
  }

  public async restore(id: string): Promise<void> {
    await this.api.json<unknown>('owner', 'POST', `items/${id}/restore`);
  }

  public async movements(id: string): Promise<ReadonlyArray<Movement>> {
    const page = await this.api.json<{ items: Movement[] }>('owner', 'GET', `items/${id}/movements?page=1&pageSize=100`);
    return page.items;
  }

  public async linkProducts(id: string, links: ReadonlyArray<{ productId: string; quantityPerSale: number }>): Promise<void> {
    await this.api.json<unknown>('owner', 'PUT', `items/${id}/product-links`, { itemId: id, productLinks: links });
  }
}
