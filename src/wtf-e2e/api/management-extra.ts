import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { Category, SubCategory } from '@data/enums';
import { Role } from '@data/users';
import { unique, uniqueCode } from '@utils/unique';

export interface ListedRecord {
  readonly id: string;
  readonly isActive: boolean;
  readonly name?: string;
  readonly code?: string;
  readonly username?: string;
  readonly firstName?: string;
}

export class ManagementExtraApi {
  public constructor(private readonly api: ApiClient) {}

  public productBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: unique('E2E Mgmt'),
      code: uniqueCode(),
      description: 'Created by the management E2E suite',
      price: 90,
      category: Category.Drink,
      isAddOn: false,
      isActive: true,
      subCategory: SubCategory.Coffee,
      ...overrides,
    };
  }

  public customerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { firstName: unique('Mgmt'), lastName: 'Customer', address: '2 Test Street', contactNumber: '09171234567', ...overrides };
  }

  public userBody(password: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { firstName: unique('Mgmt'), lastName: 'User', username: unique('mg').replace(/\s/g, '').toLowerCase(), password, roleId: 2, ...overrides };
  }

  public async post(path: string, body: unknown, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'POST', path, { body });
  }

  public async put(path: string, body: unknown, role: Role = 'superadmin'): Promise<APIResponse> {
    return this.api.call(role, 'PUT', path, { body });
  }

  public async list(path: string, role: Role = 'superadmin'): Promise<ReadonlyArray<ListedRecord>> {
    return this.api.json<ReadonlyArray<ListedRecord>>(role, 'GET', path);
  }

  public async priceHistory(productId: string): Promise<ReadonlyArray<{ oldPrice: number; newPrice: number }>> {
    return this.api.json('superadmin', 'GET', `products/${productId}/price-history`);
  }

  public async addOnsOf(productId: string): Promise<string> {
    return JSON.stringify(await this.api.json('superadmin', 'GET', `products/${productId}/addons`));
  }
}
