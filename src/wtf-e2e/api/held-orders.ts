import { APIRequestContext } from '@playwright/test';
import { PlatformApi } from '@api/platform';
import { ShopProduct, ShopSession } from '@api/shop-session';
import { ROLE_IDS } from '@data/users';
import { TestShop, openShop } from '@utils/tenants';
import { isoInDays } from '@utils/dates';
import { unique, uniqueUsername } from '@utils/unique';

export interface HeldPerson {
  readonly username: string;
  readonly password: string;
  readonly firstName: string;
  readonly session: ShopSession;
}

export interface SeededHeldOrder {
  readonly orderId: string;
  readonly orderNumber: number;
}

interface SyncResult {
  readonly orderId: string | null;
  readonly orderNumber: number | null;
  readonly status: number | null;
  readonly error: string | null;
}

// A shop of its own, so bulk approve (which acts on every held order of the shop) never touches another test's orders.
export class HeldOrdersShop {
  private constructor(
    public readonly shop: TestShop,
    private readonly request: APIRequestContext,
  ) {}

  public static async open(request: APIRequestContext, platform: PlatformApi): Promise<HeldOrdersShop> {
    return new HeldOrdersShop(await openShop(request, platform), request);
  }

  public get owner(): ShopSession {
    return this.shop.owner;
  }

  public async product(price: number, name: string = unique('Held Latte')): Promise<ShopProduct> {
    return this.owner.createProduct(name, price);
  }

  public async person(roleId: number, firstName: string): Promise<HeldPerson> {
    const username = uniqueUsername();
    const password = `Pw-${unique('e2e').replace(/\s/g, '')}Aa1!`;
    await this.owner.json<unknown>('POST', 'users', { firstName, lastName: 'E2E', username, password, roleId });
    return { username, password, firstName, session: await ShopSession.signIn(this.request, username, password) };
  }

  public async cashier(firstName: string): Promise<HeldPerson> {
    return this.person(ROLE_IDS.Cashier, firstName);
  }

  public async viewer(firstName: string): Promise<HeldPerson> {
    return this.person(ROLE_IDS.AdminViewer, firstName);
  }

  // The register sold the product at quotedPrice; the shop's price is different now, so the real sync endpoint holds it.
  public async seedHeld(
    cashier: HeldPerson,
    product: ShopProduct,
    quotedPrice: number,
    options: { readonly quantity?: number; readonly daysAgo?: number } = {},
  ): Promise<SeededHeldOrder> {
    const quantity = options.quantity ?? 1;
    const createdAt = options.daysAgo ? isoInDays(-options.daysAgo) : new Date().toISOString();
    const localId = `E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000)}`;
    const results = await cashier.session.json<SyncResult[]>('POST', 'orders/sync', {
      orders: [
        {
          customerId: null,
          items: [{ productId: product.id, quantity, addOns: [], specialInstructions: null, bundlePromotionId: null, quotedPrice }],
          bundlePromotions: [],
          status: 2,
          paymentMethod: 1,
          amountReceived: 100000,
          tips: null,
          offlineLocalId: localId,
          createdAt,
        },
      ],
    });
    const [result] = results;
    if (result.error || result.status !== 6 || !result.orderId || result.orderNumber === null) {
      throw new Error(`The order was not held for review: ${JSON.stringify(result)}`);
    }

    return { orderId: result.orderId, orderNumber: result.orderNumber };
  }

  public async status(orderId: string): Promise<number> {
    return (await this.owner.json<{ status: number }>('GET', `orders/${orderId}`)).status;
  }
}
