import { ApiClient } from '@api/client';
import { unique } from '@utils/unique';

export interface Customer {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly isActive: boolean;
}

export interface OrderingLink {
  readonly id: string;
  readonly token: string;
  readonly url?: string;
}

export class CustomersApi {
  public constructor(private readonly api: ApiClient) {}

  public async create(firstName: string = unique('Cust')): Promise<Customer> {
    return this.api.json<Customer>('superadmin', 'POST', 'customers', {
      firstName,
      lastName: 'E2E',
      address: '1 Test Street',
      contactNumber: '09170000000',
    });
  }

  public async remove(id: string): Promise<void> {
    await this.api.json<unknown>('superadmin', 'DELETE', `customers/${id}`);
  }

  public async allowLinks(id: string, allow: boolean = true): Promise<void> {
    await this.api.json<unknown>('admin', 'PUT', `customers/${id}/ordering-link-access`, { allow });
  }

  public async createLink(id: string): Promise<OrderingLink> {
    return this.api.json<OrderingLink>('admin', 'POST', `customers/${id}/ordering-links`, {});
  }

  public async revokeLink(customerId: string, linkId: string): Promise<void> {
    await this.api.json<unknown>('admin', 'DELETE', `customers/${customerId}/ordering-links/${linkId}`);
  }

  public async withLink(): Promise<{ customer: Customer; link: OrderingLink }> {
    const customer = await this.create();
    await this.allowLinks(customer.id);
    const link = await this.createLink(customer.id);
    return { customer, link };
  }
}
