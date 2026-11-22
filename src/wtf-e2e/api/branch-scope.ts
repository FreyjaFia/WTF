import { randomInt } from 'node:crypto';
import { APIResponse, expect } from '@playwright/test';
import { ApiClient, CallOptions, HttpMethod } from '@api/client';
import { Branch } from '@api/branches';
import { Api } from '@api/index';
import { Order } from '@api/orders';
import { Product } from '@api/products';
import { testPassword } from '@data/env';
import { ROLE_IDS } from '@data/users';
import { unique, uniqueUsername } from '@utils/unique';

export type ScopedKind = 'cashier' | 'manager';

export interface ScopedUser {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  readonly kind: ScopedKind;
}

// The manager is the Admin role limited to chosen branches ("limited manager"); the cashier is limited by default.
const ROLE_OF: Record<ScopedKind, number> = { cashier: ROLE_IDS.Cashier, manager: ROLE_IDS.Admin };

export function branchCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function inBranch(branchId: string): Record<string, string> {
  return { 'X-Branch-Id': branchId };
}

export class BranchScopeApi {
  public constructor(private readonly api: Api) {}

  private get client(): ApiClient {
    return this.api.client;
  }

  public async createUser(kind: ScopedKind, branchIds: readonly string[], defaultBranchId: string = branchIds[0]): Promise<ScopedUser> {
    const username = uniqueUsername('bs');
    const created = await this.client.call('owner', 'POST', 'users', {
      headers: inBranch(branchIds[0]),
      body: {
        firstName: unique('Scoped'),
        lastName: kind === 'manager' ? 'Manager' : 'Cashier',
        username,
        password: testPassword(),
        roleId: ROLE_OF[kind],
      },
    });
    const user = await ApiClient.parse<{ id: string }>(created, 'create scoped user');
    const access = await this.client.call('owner', 'PUT', `users/${user.id}/branch-access`, {
      body: { isAllBranches: false, branchIds: [...branchIds], defaultBranchId },
    });
    expect(access.ok(), `branch access -> ${access.status()} ${await access.text()}`).toBeTruthy();
    return { id: user.id, username, password: testPassword(), kind };
  }

  public async callAs(user: ScopedUser, method: HttpMethod, path: string, options: CallOptions = {}): Promise<APIResponse> {
    const token = await this.client.tokenForUser(user.username, user.password);
    return this.client.callWithToken(token, method, path, options);
  }

  public async asOwner(method: HttpMethod, path: string, options: CallOptions = {}): Promise<APIResponse> {
    return this.client.call('owner', method, path, options);
  }

  public async placeOrder(branchId: string, product: Product, quantity: number = 1): Promise<Order> {
    const response = await this.client.call('owner', 'POST', 'orders', {
      headers: inBranch(branchId),
      body: this.api.orders.body({ items: [{ productId: product.id, quantity }] }),
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as Order;
  }

  public async cleanup(users: readonly ScopedUser[], branches: readonly Branch[]): Promise<void> {
    for (const user of users) {
      await this.client.call('owner', 'DELETE', `users/${user.id}`);
    }

    for (const branch of branches) {
      await this.api.branches.closeQuietly(branch.id);
    }
  }
}

export interface World {
  readonly scope: BranchScopeApi;
  readonly branchA: Branch;
  readonly branchB: Branch;
  readonly drinkA: Product;
  readonly drinkB: Product;
  readonly orderA: Order;
  readonly orderB: Order;
  readonly cashier: ScopedUser;
  readonly manager: ScopedUser;
}

// Two new branches, each with one order for its own drink, and a cashier and a manager who work in branch A only.
export async function openWorld(api: Api): Promise<World> {
  const scope = new BranchScopeApi(api);
  const branchA = await api.branches.create(branchCode(), unique('Quezon Ave'));
  const branchB = await api.branches.create(branchCode(), unique('Makati Ayala'));
  const drinkA = await api.products.create({ name: unique('Cebu Latte'), price: 137 });
  const drinkB = await api.products.create({ name: unique('Davao Mocha'), price: 263 });
  const orderA = await scope.placeOrder(branchA.id, drinkA);
  const orderB = await scope.placeOrder(branchB.id, drinkB);
  const cashier = await scope.createUser('cashier', [branchA.id]);
  const manager = await scope.createUser('manager', [branchA.id]);
  return { scope, branchA, branchB, drinkA, drinkB, orderA, orderB, cashier, manager };
}

export async function closeWorld(world: World | undefined): Promise<void> {
  if (world) {
    await world.scope.cleanup([world.cashier, world.manager], [world.branchA, world.branchB]);
  }
}
