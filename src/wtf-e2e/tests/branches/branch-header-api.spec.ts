import { APIResponse } from '@playwright/test';
import { Branch } from '@api/branches';
import { ScopedUser, World, branchCode, closeWorld, inBranch, openWorld } from '@api/branch-scope';
import { CallOptions, HttpMethod } from '@api/client';
import { expect, test } from '@fixtures/index';
import { today } from '@utils/dates';
import { openShop } from '@utils/tenants';
import { unique } from '@utils/unique';

type Actor = 'cashier' | 'manager' | 'owner';

const NOT_ALLOWED = 'You cannot use that branch.';
const PICK_FIRST = 'Pick a branch first.';
const RANDOM_BRANCH = '7c0f5d3e-2b41-4a6e-9d58-1f3a8b6c2e90';
const ACTORS: ReadonlyArray<Actor> = ['cashier', 'manager', 'owner'];

function as(world: World, actor: Actor): (method: HttpMethod, path: string, options?: CallOptions) => Promise<APIResponse> {
  if (actor === 'owner') {
    return (method, path, options) => world.scope.asOwner(method, path, options);
  }

  const user: ScopedUser = actor === 'cashier' ? world.cashier : world.manager;
  return (method, path, options) => world.scope.callAs(user, method, path, options);
}

async function messageOf(response: APIResponse): Promise<string> {
  return ((await response.json()) as { message?: string }).message ?? '';
}

function orderBody(world: World): Record<string, unknown> {
  return {
    customerId: null,
    items: [{ productId: world.drinkA.id, quantity: 1, addOns: [], specialInstructions: null, bundlePromotionId: null }],
    bundlePromotions: [],
    status: 2,
    paymentMethod: 1,
    amountReceived: 100000,
    tips: null,
  };
}

async function orderIdsIn(world: World, branch: Branch): Promise<string[]> {
  const response = await world.scope.asOwner('GET', 'orders/paged?page=1&pageSize=100', { headers: inBranch(branch.id) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map((order) => order.id);
}

test.describe('a tampered X-Branch-Id header is refused @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  for (const actor of ACTORS) {
    test(`${actor}: a branch id that does not exist is refused on read and write with 403`, async () => {
      const call = as(world!, actor);
      const read = await call('GET', 'orders/paged?page=1&pageSize=10', { headers: inBranch(RANDOM_BRANCH) });
      expect(read.status()).toBe(403);
      expect(await messageOf(read)).toBe(NOT_ALLOWED);

      const write = await call('POST', 'orders', { headers: inBranch(RANDOM_BRANCH), body: orderBody(world!) });
      expect(write.status()).toBe(403);
      expect(await messageOf(write)).toBe(NOT_ALLOWED);
    });

    test(`${actor}: a branch of another shop is refused on read and write with 403`, async ({ request, platform }) => {
      const otherShop = await openShop(request, platform);
      const mine = await otherShop.owner.json<{ branches: { id: string }[] }>('GET', 'branches/mine');
      const foreign = mine.branches[0].id;
      const call = as(world!, actor);

      const read = await call('GET', 'orders/paged?page=1&pageSize=10', { headers: inBranch(foreign) });
      expect(read.status()).toBe(403);
      expect(await messageOf(read)).toBe(NOT_ALLOWED);

      const write = await call('POST', 'orders', { headers: inBranch(foreign), body: orderBody(world!) });
      expect(write.status()).toBe(403);

      const kitchen = await call('GET', 'kitchen/orders', { headers: inBranch(foreign) });
      expect(kitchen.status()).toBe(403);
    });

    test(`${actor}: All branches on a write is refused with 400 and nothing is saved`, async () => {
      const call = as(world!, actor);
      const before = (await orderIdsIn(world!, world!.branchA)).length;

      const write = await call('POST', 'orders', { headers: inBranch('all'), body: orderBody(world!) });
      expect(write.status()).toBe(400);
      expect(await messageOf(write)).toBe(PICK_FIRST);

      const wrongCase = await call('POST', 'orders', { headers: inBranch('ALL'), body: orderBody(world!) });
      expect(wrongCase.status()).toBe(400);

      expect(await orderIdsIn(world!, world!.branchA)).toHaveLength(before);
    });

    test(`${actor}: a closed branch cannot be written to (403); only the owner can still read its history`, async ({ api }) => {
      const shop = world!;
      const closed = await api.branches.create(branchCode(), unique('Closed Cubao'));
      const staff = await shop.scope.createUser(actor === 'manager' ? 'manager' : 'cashier', [shop.branchA.id, closed.id]);
      try {
        const placed = await shop.scope.placeOrder(closed.id, shop.drinkA);
        const closing = await shop.scope.asOwner('POST', `branches/${closed.id}/close`, {
          headers: inBranch(shop.branchA.id),
          body: { moveStaffToBranchId: null },
        });
        expect(closing.ok(), await closing.text()).toBeTruthy();

        const call =
          actor === 'owner'
            ? as(shop, 'owner')
            : (method: HttpMethod, path: string, options?: CallOptions) => shop.scope.callAs(staff, method, path, options);
        const write = await call('POST', 'orders', { headers: inBranch(closed.id), body: orderBody(shop) });
        expect(write.status()).toBe(403);
        expect(await messageOf(write)).toBe(NOT_ALLOWED);

        const read = await call('GET', `orders/${placed.id}`, { headers: inBranch(closed.id) });
        expect(read.status()).toBe(actor === 'owner' ? 200 : 403);
      } finally {
        await shop.scope.cleanup([staff], []);
      }
    });
  }

  for (const actor of ['cashier', 'manager'] as const) {
    test(`${actor}: another branch of the same shop is refused with 403 and its orders stay hidden`, async () => {
      const call = as(world!, actor);
      const read = await call('GET', 'orders/paged?page=1&pageSize=100', { headers: inBranch(world!.branchB.id) });
      expect(read.status()).toBe(403);
      expect(await messageOf(read)).toBe(NOT_ALLOWED);

      const write = await call('POST', 'orders', { headers: inBranch(world!.branchB.id), body: orderBody(world!) });
      expect(write.status()).toBe(403);
      expect(await orderIdsIn(world!, world!.branchB)).toEqual([world!.orderB.id]);
    });

    test(`${actor}: All branches on a read shows only the branches they work in`, async () => {
      const call = as(world!, actor);
      const response = await call('GET', 'orders/paged?page=1&pageSize=100', { headers: inBranch('all') });
      expect(response.status()).toBe(200);
      const ids = ((await response.json()) as { items: { id: string }[] }).items.map((order) => order.id);
      expect(ids).toContain(world!.orderA.id);
      expect(ids).not.toContain(world!.orderB.id);

      const single = await call('GET', `orders/${world!.orderB.id}`, { headers: inBranch('all') });
      expect(single.status()).toBe(404);
    });

    test(`${actor}: no header at all works in their own branch`, async () => {
      const call = as(world!, actor);
      const response = await call('GET', 'orders/paged?page=1&pageSize=100');
      expect(response.status()).toBe(200);
      const ids = ((await response.json()) as { items: { id: string }[] }).items.map((order) => order.id);
      expect(ids).toEqual([world!.orderA.id]);
    });
  }
});

test.describe('a branch id inside the request body cannot move an order @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  for (const actor of ['cashier', 'manager'] as const) {
    test(`${actor}: BranchId in the order body is ignored, the order lands in their own branch`, async () => {
      const shop = world!;
      const call = as(shop, actor);
      const response = await call('POST', 'orders', { body: { ...orderBody(shop), branchId: shop.branchB.id } });
      expect(response.status(), await response.text()).toBe(201);
      const order = (await response.json()) as { id: string; branchCode: string };
      expect(order.branchCode).toBe(shop.branchA.code);

      const inB = await orderIdsIn(shop, shop.branchB);
      expect(inB).toEqual([shop.orderB.id]);
      expect(inB).not.toContain(order.id);
    });

    test(`${actor}: BranchId in the body together with a header for their own branch still lands in their own branch`, async () => {
      const shop = world!;
      const call = as(shop, actor);
      const response = await call('POST', 'orders', {
        headers: inBranch(shop.branchA.id),
        body: { ...orderBody(shop), branchId: shop.branchB.id },
      });
      expect(response.status(), await response.text()).toBe(201);
      expect(((await response.json()) as { branchCode: string }).branchCode).toBe(shop.branchA.code);
      expect(await orderIdsIn(shop, shop.branchB)).toEqual([shop.orderB.id]);
    });
  }

  test('owner: a made-up BranchId in the body is ignored and the order lands in the branch the owner is working in', async () => {
    const shop = world!;
    const response = await shop.scope.asOwner('POST', 'orders', {
      headers: inBranch(shop.branchA.id),
      body: { ...orderBody(shop), branchId: RANDOM_BRANCH },
    });
    expect(response.status(), await response.text()).toBe(201);
    expect(((await response.json()) as { branchCode: string }).branchCode).toBe(shop.branchA.code);
  });
});

test.describe('records of another branch answer 404 @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  for (const actor of ['cashier', 'manager'] as const) {
    test(`${actor}: an order of another branch cannot be read, listed, edited or checked for stock movements`, async () => {
      const shop = world!;
      const call = as(shop, actor);
      const id = shop.orderB.id;

      expect((await call('GET', `orders/${id}`)).status()).toBe(404);
      expect((await call('GET', `orders/${id}`, { headers: inBranch(shop.branchA.id) })).status()).toBe(404);
      if (actor === 'manager') {
        expect((await call('GET', `orders/${id}/stock-movements`)).status()).toBe(404);
      }

      const edit = await call('PUT', `orders/${id}`, { body: { ...orderBody(shop), id } });
      expect(edit.status()).toBe(404);

      const owner = await shop.scope.asOwner('GET', `orders/${id}`, { headers: inBranch(shop.branchB.id) });
      expect(owner.status()).toBe(200);
      expect(((await owner.json()) as { items: { quantity: number }[] }).items).toHaveLength(1);
    });
  }

  test('manager: a kitchen card of another branch cannot be moved, marked seen or dismissed', async () => {
    const shop = world!;
    const call = as(shop, 'manager');
    const id = shop.orderB.id;

    expect((await call('POST', `kitchen/orders/${id}/state`, { body: { to: 1 } })).status()).toBe(404);
    expect((await call('POST', `kitchen/orders/${id}/seen`)).status()).toBe(404);
    expect((await call('POST', `kitchen/orders/${id}/dismiss`)).status()).toBe(404);

    const board = await call('GET', 'kitchen/orders');
    expect(board.status()).toBe(200);
    const ids = ((await board.json()) as { orders: { id: string }[] }).orders.map((card) => card.id);
    expect(ids).toContain(shop.orderA.id);
    expect(ids).not.toContain(shop.orderB.id);

    const stillThere = await shop.scope.asOwner('GET', 'kitchen/orders', { headers: inBranch(shop.branchB.id) });
    const cards = ((await stillThere.json()) as { orders: { id: string; kitchenState?: string | number }[] }).orders;
    expect(cards.map((card) => card.id)).toEqual([shop.orderB.id]);
  });

  test('manager: stock counts, waste records and expenses of another branch cannot be read or changed', async ({ api }) => {
    const shop = world!;
    const item = await api.items.create({ startingQuantity: 40 });
    const call = as(shop, 'manager');
    const inB = inBranch(shop.branchB.id);

    const count = await shop.scope.asOwner('POST', 'stock-counts', {
      headers: inB,
      body: { name: unique('Count Ayala'), isBlind: false, note: null, itemIds: [item.id] },
    });
    expect(count.status(), await count.text()).toBeLessThan(300);
    const countId = ((await count.json()) as { summary: { id: string } }).summary.id;
    expect((await call('GET', `stock-counts/${countId}`)).status()).toBe(404);
    expect((await call('POST', `stock-counts/${countId}/cancel`)).status()).toBe(404);
    expect((await shop.scope.asOwner('GET', `stock-counts/${countId}`, { headers: inB })).status()).toBe(200);

    const waste = await shop.scope.asOwner('POST', `items/${item.id}/stock/waste`, {
      headers: inB,
      body: { quantity: 2, wasteReasonId: 1, notes: null, source: 1, clientRequestId: crypto.randomUUID() },
    });
    expect(waste.status(), await waste.text()).toBeLessThan(300);
    const wasteId = ((await waste.json()) as { id: string }).id;
    expect((await call('POST', `stock-waste/${wasteId}/confirm`, { body: { note: null } })).status()).toBe(404);
    expect((await call('POST', `stock-waste/${wasteId}/reverse`, { body: { reason: 'Wrong branch' } })).status()).toBe(404);

    const expense = await shop.scope.asOwner('POST', 'expenses', {
      headers: inB,
      body: { expenseDate: today(), category: 1, amount: 321, note: unique('Gas refill') },
    });
    expect(expense.status(), await expense.text()).toBeLessThan(300);
    const expenseId = ((await expense.json()) as { id: string }).id;
    expect((await call('DELETE', `expenses/${expenseId}`)).status()).toBe(404);
    expect((await shop.scope.asOwner('DELETE', `expenses/${expenseId}`, { headers: inB })).status()).toBeLessThan(300);
  });

  test(`manager: reports count only their own branch and refuse another one`, async () => {
    const shop = world!;
    const call = as(shop, 'manager');
    const date = today();
    const path = `reports/product-sales?fromDate=${date}&toDate=${date}`;

    const own = await call('GET', path);
    expect(own.status(), await own.text()).toBe(200);
    const ownText = await own.text();
    expect(ownText).toContain(shop.drinkA.name);
    expect(ownText).not.toContain(shop.drinkB.name);

    const everywhere = await call('GET', path, { headers: inBranch('all') });
    expect(everywhere.status()).toBe(200);
    const everywhereText = await everywhere.text();
    expect(everywhereText).toContain(shop.drinkA.name);
    expect(everywhereText).not.toContain(shop.drinkB.name);

    const other = await call('GET', path, { headers: inBranch(shop.branchB.id) });
    expect(other.status()).toBe(403);

    const close = await call('GET', `reports/daily-close?fromDate=${date}&toDate=${date}`);
    expect(close.status()).toBe(200);
    expect(await close.text()).not.toContain(shop.branchB.name);

    const ownerOnB = await shop.scope.asOwner('GET', path, { headers: inBranch(shop.branchB.id) });
    expect(await ownerOnB.text()).toContain(shop.drinkB.name);
  });
});
