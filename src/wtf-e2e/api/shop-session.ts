import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { API_ORIGIN, TIME_ZONE } from '@data/env';
import { unique, uniqueCode } from '@utils/unique';

export interface ShopLogin {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface ShopProduct {
  readonly id: string;
  readonly name: string;
}

export interface ShopCustomer {
  readonly id: string;
  readonly firstName: string;
}

export interface ShopOrder {
  readonly id: string;
  readonly orderNumber: number;
  readonly totalAmount: number;
}

// One person signed in to one shop through the API. Unlike ApiClient it keeps no token cache shared between tests,
// because the tenant tests suspend shops, reset passwords and so on, which changes what a token is worth.
export class ShopSession {
  public constructor(
    private readonly request: APIRequestContext,
    public readonly username: string,
    public readonly accessToken: string,
    public readonly refreshToken: string,
  ) {}

  public static async attempt(request: APIRequestContext, username: string, password: string): Promise<APIResponse> {
    return request.post(`${API_ORIGIN}/api/auth/login`, { data: { username, password } });
  }

  public static async signIn(request: APIRequestContext, username: string, password: string): Promise<ShopSession> {
    const response = await ShopSession.attempt(request, username, password);
    expect(response.ok(), `sign in ${username} -> ${response.status()} ${await response.text()}`).toBeTruthy();
    const login = (await response.json()) as ShopLogin;
    return new ShopSession(request, username, login.accessToken, login.refreshToken);
  }

  public static withToken(request: APIRequestContext, username: string, accessToken: string): ShopSession {
    return new ShopSession(request, username, accessToken, '');
  }

  public async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<APIResponse> {
    return this.request.fetch(`${API_ORIGIN}/api/${path.replace(/^\//, '')}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'X-TimeZone': TIME_ZONE },
      data: body,
    });
  }

  public async json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const response = await this.call(method, path, body);
    const text = await response.text();
    expect(response.ok(), `${this.username} ${method} ${path} -> ${response.status()} ${text}`).toBeTruthy();
    return (text ? JSON.parse(text) : null) as T;
  }

  public async refresh(): Promise<APIResponse> {
    return this.request.post(`${API_ORIGIN}/api/auth/refresh`, {
      data: { refreshToken: this.refreshToken },
    });
  }

  // A shop made through the platform starts with the first shop's categories under new ids, so look the ids up.
  public async firstCategory(): Promise<{ category: number; subCategory: number | null }> {
    const catalog = await this.json<{ categories: { id: number; subCategories: { id: number }[] }[] }>('GET', 'catalog');
    const category = catalog.categories.find((c) => c.subCategories.length > 0) ?? catalog.categories[0];
    return { category: category.id, subCategory: category.subCategories[0]?.id ?? null };
  }

  public async createProduct(name: string = unique('Tenant Drink'), price: number = 100): Promise<ShopProduct> {
    const { category, subCategory } = await this.firstCategory();
    return this.json<ShopProduct>('POST', 'products', {
      name,
      code: uniqueCode(),
      description: 'Created by the tenant E2E tests',
      price,
      category,
      isAddOn: false,
      isActive: true,
      subCategory,
    });
  }

  public async createCustomer(firstName: string = unique('Tenant Cust')): Promise<ShopCustomer> {
    return this.json<ShopCustomer>('POST', 'customers', {
      firstName,
      lastName: 'E2E',
      address: '1 Test Street',
      contactNumber: '09170000000',
    });
  }

  public async createOrderRaw(productId: string, quantity: number = 1): Promise<APIResponse> {
    return this.call('POST', 'orders', this.orderBody(productId, quantity));
  }

  public async createOrder(productId: string, quantity: number = 1): Promise<ShopOrder> {
    return this.json<ShopOrder>('POST', 'orders', this.orderBody(productId, quantity));
  }

  private orderBody(productId: string, quantity: number): Record<string, unknown> {
    return {
      customerId: null,
      items: [{ productId, quantity, addOns: [], specialInstructions: null, bundlePromotionId: null }],
      bundlePromotions: [],
      status: 2,
      paymentMethod: 1,
      amountReceived: 100000,
      tips: null,
    };
  }
}
