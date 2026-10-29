import { APIRequestContext } from '@playwright/test';
import { ApiClient } from '@api/client';
import { CustomersApi } from '@api/customers';
import { ItemsApi } from '@api/items';
import { OrdersApi } from '@api/orders';
import { ProductsApi } from '@api/products';
import { PromotionsApi } from '@api/promotions';
import { PublicShopApi } from '@api/public-shop';
import { UsersApi } from '@api/users';
import { WasteApi } from '@api/waste';

export class Api {
  public readonly client: ApiClient;
  public readonly items: ItemsApi;
  public readonly products: ProductsApi;
  public readonly orders: OrdersApi;
  public readonly customers: CustomersApi;
  public readonly shop: PublicShopApi;
  public readonly users: UsersApi;
  public readonly waste: WasteApi;
  public readonly promotions: PromotionsApi;

  public constructor(request: APIRequestContext) {
    this.client = new ApiClient(request);
    this.items = new ItemsApi(this.client);
    this.products = new ProductsApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.shop = new PublicShopApi(this.client);
    this.users = new UsersApi(this.client);
    this.waste = new WasteApi(this.client);
    this.promotions = new PromotionsApi(this.client);
  }
}
