import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { FulfillmentType, PaymentMethod } from '@data/enums';

export interface PublicOrderLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface PublicOrder {
  readonly id: string;
  readonly orderNumber: number;
}

export class PublicShopApi {
  public constructor(private readonly api: ApiClient) {}

  public async catalog(token: string): Promise<APIResponse> {
    return this.api.call(null, 'GET', `public/order-links/${token}`);
  }

  public async submit(token: string, items: readonly PublicOrderLine[], total: number): Promise<PublicOrder> {
    const response = await this.api.call(null, 'POST', `public/order-links/${token}/orders`, {
      body: {
        items: items.map((line) => ({ ...line, addOns: [], specialInstructions: null })),
        fulfillment: FulfillmentType.Pickup,
        deliveryAddress: null,
        contactNumber: '09171234567',
        paymentMethod: PaymentMethod.Cash,
        amountReceived: total,
        specialInstructions: null,
        tips: null,
        expectedTotal: total,
        saveContactNumber: false,
        saveAddress: false,
      },
    });
    return ApiClient.parse<PublicOrder>(response, 'public submit');
  }
}
