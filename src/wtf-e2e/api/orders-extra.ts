import { APIResponse, expect } from '@playwright/test';
import { ApiClient } from '@api/client';
import { OrderInput, OrdersApi } from '@api/orders';
import { OrderStatus } from '@data/enums';
import { FulfillmentType, PaymentMethod } from '@data/enums';
import { Role } from '@data/users';

export interface PublicSubmitOptions {
  readonly items: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
    readonly addOns?: ReadonlyArray<{ readonly productId: string; readonly quantity: number }>;
  }>;
  readonly fulfillment?: number;
  readonly deliveryAddress?: string | null;
  readonly contactNumber?: string | null;
  readonly paymentMethod?: number;
  readonly amountReceived?: number | null;
  readonly tips?: number | null;
  readonly expectedTotal?: number | null;
}

export interface ChatMessage {
  readonly id: string;
  readonly sender: string;
  readonly body: string;
}

export interface Chat {
  readonly canSend: boolean;
  readonly closedReason: string | null;
  readonly unreadCount: number;
  readonly messages: readonly ChatMessage[];
}

export interface ConversationList {
  readonly unreadConversations: number;
  readonly items: ReadonlyArray<{ readonly orderId: string | null; readonly unreadCount: number; readonly lastMessage: string }>;
}

export class OrdersExtraApi {
  public constructor(
    private readonly api: ApiClient,
    private readonly orders: OrdersApi,
  ) {}

  public createWith(input: OrderInput, extra: Record<string, unknown>, role: Role = 'cashier'): Promise<APIResponse> {
    return this.api.call(role, 'POST', 'orders', { body: { ...this.orders.body(input), ...extra } });
  }

  public update(id: string, input: OrderInput, extra: Record<string, unknown> = {}, role: Role = 'cashier'): Promise<APIResponse> {
    return this.api.call(role, 'PUT', `orders/${id}`, { body: { ...this.orders.body(input), ...extra, id } });
  }

  public complete(id: string, input: OrderInput, role: Role = 'cashier'): Promise<APIResponse> {
    return this.update(id, { ...input, status: OrderStatus.Completed }, {}, role);
  }

  public override(id: string, input: OrderInput, reason: string | null, role: Role = 'admin'): Promise<APIResponse> {
    return this.api.call(role, 'PUT', `orders/${id}/override`, {
      body: { ...this.orders.body({ ...input, status: OrderStatus.Completed }), id, overrideReason: reason },
    });
  }

  public submitRaw(token: string, options: PublicSubmitOptions): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'POST', `public/order-links/${token}/orders`, {
      body: {
        items: options.items.map((line) => ({ specialInstructions: null, addOns: [], ...line })),
        fulfillment: options.fulfillment ?? FulfillmentType.Pickup,
        deliveryAddress: options.deliveryAddress ?? null,
        contactNumber: options.contactNumber === undefined ? '09171234567' : options.contactNumber,
        paymentMethod: options.paymentMethod ?? PaymentMethod.Cash,
        amountReceived: options.amountReceived === undefined ? 100000 : options.amountReceived,
        specialInstructions: null,
        tips: options.tips ?? null,
        expectedTotal: options.expectedTotal ?? null,
        saveContactNumber: false,
        saveAddress: false,
      },
    }));
  }

  public async limited(call: () => Promise<APIResponse>): Promise<APIResponse> {
    let last: APIResponse | null = null;
    await expect
      .poll(
        async () => {
          last = await call();
          return last.status();
        },
        { timeout: 120_000, intervals: [1_000, 3_000, 5_000] },
      )
      .not.toBe(429);
    return last as unknown as APIResponse;
  }

  public publicCatalog(token: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'GET', `public/order-links/${token}`));
  }

  public publicOrders(token: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'GET', `public/order-links/${token}/orders`));
  }

  public async place(token: string, options: PublicSubmitOptions): Promise<{ id: string; orderNumber: number }> {
    return ApiClient.parse<{ id: string; orderNumber: number }>(await this.submitRaw(token, options), 'public submit');
  }

  public publicOrder(token: string, orderId: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'GET', `public/order-links/${token}/orders/${orderId}`));
  }

  public publicChat(token: string, orderId: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'GET', `public/order-links/${token}/orders/${orderId}/messages`));
  }

  public publicSend(token: string, orderId: string, body: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'POST', `public/order-links/${token}/orders/${orderId}/messages`, { body: { body } }));
  }

  public publicRead(token: string, orderId: string): Promise<APIResponse> {
    return this.limited(() => this.api.call(null, 'POST', `public/order-links/${token}/orders/${orderId}/messages/read`));
  }

  public staffSend(orderId: string, body: string, role: Role = 'cashier'): Promise<APIResponse> {
    return this.api.call(role, 'POST', `orders/${orderId}/messages`, { body: { body } });
  }

  public staffChat(orderId: string, role: Role = 'cashier'): Promise<Chat> {
    return this.api.json<Chat>(role, 'GET', `orders/${orderId}/conversation`);
  }

  public staffConversations(role: Role = 'cashier'): Promise<ConversationList> {
    return this.api.json<ConversationList>(role, 'GET', 'conversations');
  }

  public async chatOf(token: string, orderId: string): Promise<Chat> {
    return ApiClient.parse<Chat>(await this.publicChat(token, orderId), 'public chat');
  }

  public disableLinks(customerId: string): Promise<APIResponse> {
    return this.api.call('admin', 'PUT', `customers/${customerId}/ordering-link-access`, { body: { allow: false } });
  }

  public setLinkAccess(customerId: string, allow: boolean): Promise<APIResponse> {
    return this.api.call('admin', 'PUT', `customers/${customerId}/ordering-link-access`, { body: { allow } });
  }

  public createLinkWithExpiry(customerId: string, expiresAt: string): Promise<APIResponse> {
    return this.api.call('admin', 'POST', `customers/${customerId}/ordering-links`, { body: { expiresAt } });
  }
}
