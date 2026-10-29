import { ApiClient } from '@api/client';
import { AddOnType, Category, SubCategory } from '@data/enums';
import { unique, uniqueCode } from '@utils/unique';

export interface ProductInput {
  readonly name?: string;
  readonly price?: number;
  readonly isAddOn?: boolean;
  readonly category?: number;
  readonly subCategory?: number | null;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly isActive: boolean;
}

export interface AddOnLink {
  readonly addOnId: string;
  readonly addOnType: number;
}

export class ProductsApi {
  public constructor(private readonly api: ApiClient) {}

  public async create(input: ProductInput = {}): Promise<Product> {
    const isAddOn = input.isAddOn ?? false;
    return this.api.json<Product>('superadmin', 'POST', 'products', {
      name: input.name ?? unique(isAddOn ? 'E2E AddOn' : 'E2E Drink'),
      code: uniqueCode(),
      description: 'Created by the E2E suite',
      price: input.price ?? 100,
      category: input.category ?? (isAddOn ? Category.Other : Category.Drink),
      isAddOn,
      isActive: true,
      subCategory: input.subCategory === undefined ? (isAddOn ? null : SubCategory.Coffee) : input.subCategory,
    });
  }

  public async get(id: string): Promise<Product> {
    return this.api.json<Product>('superadmin', 'GET', `products/${id}`);
  }

  public async setPrice(id: string, price: number): Promise<void> {
    const current = await this.api.json<Record<string, unknown>>('superadmin', 'GET', `products/${id}`);
    await this.api.json<unknown>('superadmin', 'PUT', `products/${id}`, { ...current, price, id });
  }

  public async remove(id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'DELETE', `products/${id}`);
  }

  public async restore(id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'POST', `products/${id}/restore`);
  }

  public async linkAddOns(productId: string, addOns: readonly AddOnLink[]): Promise<void> {
    await this.api.json<unknown>('superadmin', 'POST', `products/${productId}/addons`, { productId, addOns });
  }

  public async withSize(price: number = 150, sizePrice: number = 20): Promise<{ drink: Product; size: Product }> {
    const drink = await this.create({ price });
    const size = await this.create({ isAddOn: true, price: sizePrice, name: unique('E2E Large') });
    await this.linkAddOns(drink.id, [{ addOnId: size.id, addOnType: AddOnType.Size }]);
    return { drink, size };
  }
}
