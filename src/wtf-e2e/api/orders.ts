import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { Role } from '@data/users';

export interface OrderLineInput {
  readonly productId: string;
  readonly quantity: number;
  readonly addOns?: readonly { readonly productId: string; readonly quantity: number }[];
}

export interface OrderInput {
  readonly items: readonly OrderLineInput[];
  readonly status?: number;
  readonly paymentMethod?: number;
  readonly amountReceived?: number | null;
  readonly customerId?: string | null;
  readonly tips?: number | null;
}

export interface OrderLine {
  readonly id: string;
  readonly productId: string;
  readonly quantity: number;
}

export interface Order {
  readonly id: string;
  readonly orderNumber: number;
  readonly status: number;
  readonly totalAmount: number;
  readonly items: readonly OrderLine[];
  readonly changeAmount?: number | null;
}

export class OrdersApi {
  public constructor(private readonly api: ApiClient) {}

  public body(input: OrderInput): Record<string, unknown> {
    const status = input.status ?? OrderStatus.Completed;
    const completed = status === OrderStatus.Completed;
    return {
      customerId: input.customerId ?? null,
      items: input.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        addOns: line.addOns ?? [],
        specialInstructions: null,
        bundlePromotionId: null,
      })),
      bundlePromotions: [],
      status,
      paymentMethod: completed ? (input.paymentMethod ?? PaymentMethod.Cash) : null,
      amountReceived: completed ? (input.amountReceived ?? 100000) : null,
      tips: input.tips ?? null,
    };
  }

  public async createRaw(input: OrderInput, role: Role = 'cashier'): Promise<APIResponse> {
    return this.api.call(role, 'POST', 'orders', { body: this.body(input) });
  }

  public async create(input: OrderInput, role: Role = 'cashier'): Promise<Order> {
    return ApiClient.parse<Order>(await this.createRaw(input, role), 'create order');
  }

  public async get(id: string, role: Role = 'superadmin'): Promise<Order> {
    return this.api.json<Order>(role, 'GET', `orders/${id}`);
  }

  public async withStatus(status: number): Promise<readonly Order[]> {
    const page = await this.api.json<{ items: readonly Order[] }>('superadmin', 'GET', `orders/paged?status=${status}&page=1&pageSize=100`);
    return page.items;
  }

  public async withStatusContaining(status: number, productId: string): Promise<readonly Order[]> {
    return (await this.withStatus(status)).filter((order) => order.items.some((line) => line.productId === productId));
  }

  public async approveHeld(id: string, role: Role = 'admin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `orders/${id}/review/approve`);
  }

  public async voidOrder(id: string, note: string, notReturnedLineIds: readonly string[] = [], role: Role = 'admin'): Promise<APIResponse> {
    return this.api.call(role, 'PATCH', `orders/${id}/void`, { body: { note, notReturnedLineIds } });
  }

  public async approve(id: string): Promise<void> {
    await this.api.json<unknown>('cashier', 'POST', `orders/${id}/approve`);
  }

  public async reject(id: string, reason: string): Promise<void> {
    await this.api.json<unknown>('cashier', 'POST', `orders/${id}/reject`, { reason });
  }

  public async stockMovements(id: string): Promise<readonly Record<string, unknown>[]> {
    return this.api.json<readonly Record<string, unknown>[]>('superadmin', 'GET', `orders/${id}/stock-movements`);
  }

  public async sendMessage(id: string, body: string): Promise<void> {
    await this.api.json<unknown>('cashier', 'POST', `orders/${id}/messages`, { body });
  }
}
