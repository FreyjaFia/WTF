import { APIRequestContext, APIResponse } from '@playwright/test';
import { PlatformApi } from '@api/platform';
import { ShopProduct, ShopSession } from '@api/shop-session';
import { ROLE_IDS } from '@data/users';
import { isoInDays } from '@utils/dates';
import { TestShop, openShop } from '@utils/tenants';
import { unique, uniqueUsername } from '@utils/unique';

export interface SeniorPwdPerson {
  readonly type: 1 | 2;
  readonly idNumber: string;
  readonly customerName: string;
}

export interface SeniorPwdLine {
  readonly productId: string;
  readonly quantity: number;
  readonly personIndex?: number;
}

export interface ShopUser {
  readonly username: string;
  readonly password: string;
}

interface BrandBody {
  readonly [key: string]: unknown;
}

// A shop of its own for one test: the Senior/PWD switches belong to the shop, so tests that flip them cannot share the
// seeded shop without disturbing each other.
export class SeniorPwdShop {
  private constructor(
    public readonly shop: TestShop,
    private readonly request: APIRequestContext,
  ) {}

  public static async open(
    request: APIRequestContext,
    platform: PlatformApi,
    switches: { readonly enabled: boolean; readonly vatRegistered: boolean },
  ): Promise<SeniorPwdShop> {
    const created = new SeniorPwdShop(await openShop(request, platform), request);
    await created.setSwitches(switches.enabled, switches.vatRegistered);
    return created;
  }

  public get owner(): ShopSession {
    return this.shop.owner;
  }

  public async setSwitches(enabled: boolean, vatRegistered: boolean): Promise<void> {
    const brand = await this.owner.json<BrandBody>('GET', 'settings/brand');
    await this.owner.json<unknown>('PUT', 'settings/brand', { ...brand, seniorPwdEnabled: enabled, vatRegistered });
  }

  public async product(price: number, name: string = unique('Senior Drink')): Promise<ShopProduct> {
    return this.owner.createProduct(name, price);
  }

  public async setEligible(productId: string, eligible: boolean): Promise<void> {
    const product = await this.owner.json<BrandBody>('GET', `products/${productId}`);
    await this.owner.json<unknown>('PUT', `products/${productId}`, { ...product, isSeniorPwdEligible: eligible });
  }

  public async promote(productId: string, fixedPrice: number): Promise<void> {
    await this.owner.json<unknown>('POST', 'management/promotions/discounted-products', {
      name: unique('Senior Deal'),
      isActive: true,
      startDate: isoInDays(-1),
      endDate: isoInDays(30),
      daysOfWeek: null,
      startTime: null,
      endTime: null,
      maxRedemptions: null,
      maxPerOrder: null,
      items: [{ productId, fixedPrice, percentOff: null, addOns: [] }],
    });
  }

  public async user(roleId: number): Promise<ShopUser> {
    const username = uniqueUsername();
    const password = `Pw-${unique('e2e').replace(/\s/g, '')}Aa1!`;
    await this.owner.json<unknown>('POST', 'users', { firstName: unique('User'), lastName: 'E2E', username, password, roleId });
    return { username, password };
  }

  public async cashier(): Promise<ShopUser> {
    return this.user(ROLE_IDS.Cashier);
  }

  public async viewer(): Promise<ShopUser> {
    return this.user(ROLE_IDS.AdminViewer);
  }

  public async placeOrderRaw(
    lines: readonly SeniorPwdLine[],
    persons: readonly SeniorPwdPerson[],
    session: ShopSession = this.owner,
  ): Promise<APIResponse> {
    return session.call('POST', 'orders', {
      customerId: null,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        addOns: [],
        specialInstructions: null,
        bundlePromotionId: null,
        seniorPwdPersonIndex: line.personIndex ?? null,
      })),
      bundlePromotions: [],
      seniorPwdPersons: persons,
      status: 2,
      paymentMethod: 1,
      amountReceived: 100000,
      tips: null,
    });
  }

  public async signInAs(user: ShopUser): Promise<ShopSession> {
    return ShopSession.signIn(this.request, user.username, user.password);
  }
}
