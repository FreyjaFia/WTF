import { ScopedUser, World, closeWorld, inBranch, openWorld } from '@api/branch-scope';
import { expect, test } from '@fixtures/index';
import { readXlsxStrings } from '@utils/download';
import { unique } from '@utils/unique';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const JUNK_HEADERS: ReadonlyArray<string> = ['banana', "' OR 1=1 --", 'all branches'];

function orderBody(world: World, branchId: string): Record<string, unknown> {
  return {
    customerId: null,
    items: [{ productId: world.drinkA.id, quantity: 1, addOns: [], specialInstructions: null, bundlePromotionId: null }],
    bundlePromotions: [],
    status: 2,
    paymentMethod: 1,
    amountReceived: 100000,
    tips: null,
    branchId,
    createdAt: new Date().toISOString(),
  };
}

async function idsIn(world: World, branchId: string): Promise<string[]> {
  const response = await world.scope.asOwner('GET', 'orders/paged?page=1&pageSize=100', { headers: inBranch(branchId) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map((order) => order.id);
}

// Tests marked "(needs fix) @pending-fixes" describe behaviour that was still being fixed when they were written; they
// fail until the fix lands. Run only them with --grep @pending-fixes.
test.describe('branch scope hardening @branches @security', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  test('junk text in X-Branch-Id is refused with 400 on read and write, for a cashier, a manager and the owner (needs fix) @pending-fixes', async () => {
    const shop = world!;
    const callers = [
      (path: string, headers: Record<string, string>, body?: unknown) =>
        shop.scope.callAs(shop.cashier, body ? 'POST' : 'GET', path, { headers, body }),
      (path: string, headers: Record<string, string>, body?: unknown) =>
        shop.scope.callAs(shop.manager, body ? 'POST' : 'GET', path, { headers, body }),
      (path: string, headers: Record<string, string>, body?: unknown) => shop.scope.asOwner(body ? 'POST' : 'GET', path, { headers, body }),
    ];

    for (const junk of JUNK_HEADERS) {
      for (const call of callers) {
        const read = await call('orders/paged?page=1&pageSize=10', inBranch(junk));
        expect.soft(read.status(), `read with "${junk}"`).toBe(400);

        const write = await call('orders', inBranch(junk), orderBody(shop, shop.branchA.id));
        expect.soft(write.status(), `write with "${junk}"`).toBe(400);
      }
    }

    expect(await idsIn(shop, shop.branchA.id)).toEqual([shop.orderA.id]);
  });

  test('a limited person cannot place orders in another branch through the batch or sync routes', async () => {
    const shop = world!;
    const before = await idsIn(shop, shop.branchB.id);

    for (const person of [shop.cashier, shop.manager]) {
      const batch = await shop.scope.callAs(person, 'POST', 'orders/batch', { body: { orders: [orderBody(shop, shop.branchB.id)] } });
      const sync = await shop.scope.callAs(person, 'POST', 'orders/sync', {
        body: { orders: [{ ...orderBody(shop, shop.branchB.id), offlineLocalId: unique('OFF').replace(/\s/g, '').slice(0, 30) }] },
      });
      expect(sync.status()).toBe(200);
      const synced = ((await sync.json()) as { orderId: string | null; error: string | null }[])[0];

      if (batch.ok()) {
        const created = (await batch.json()) as { branchCode: string }[];
        expect(created.map((order) => order.branchCode)).toEqual([shop.branchA.code]);
      } else {
        expect(batch.status()).toBeLessThan(500);
      }

      if (synced.orderId) {
        expect(await idsIn(shop, shop.branchA.id)).toContain(synced.orderId);
      } else {
        expect(synced.error).toBeTruthy();
      }
    }

    expect(await idsIn(shop, shop.branchB.id)).toEqual(before);
  });

  test('a limited manager cannot see, edit, delete or give access to people who work in another branch (needs fix) @pending-fixes', async ({
    api,
  }) => {
    const shop = world!;
    const stranger: ScopedUser = await shop.scope.createUser('cashier', [shop.branchB.id]);
    try {
      expect((await shop.scope.callAs(shop.manager, 'GET', `users/${stranger.id}`)).status()).toBe(404);

      const list = await shop.scope.callAs(shop.manager, 'GET', 'users');
      expect(list.status()).toBe(200);
      expect(await list.text()).not.toContain(stranger.username);

      const current = await api.client.json<Record<string, unknown>>('owner', 'GET', `users/${stranger.id}`);
      const edit = await shop.scope.callAs(shop.manager, 'PUT', `users/${stranger.id}`, {
        body: { ...current, id: stranger.id, firstName: unique('Renamed') },
      });
      expect([403, 404]).toContain(edit.status());

      const remove = await shop.scope.callAs(shop.manager, 'DELETE', `users/${stranger.id}`);
      expect([403, 404]).toContain(remove.status());

      const access = await shop.scope.callAs(shop.manager, 'PUT', `users/${stranger.id}/branch-access`, {
        body: { isAllBranches: false, branchIds: [shop.branchA.id], defaultBranchId: shop.branchA.id },
      });
      expect([403, 404]).toContain(access.status());

      const after = await api.client.json<{ firstName: string; isActive: boolean }>('owner', 'GET', `users/${stranger.id}`);
      expect(after.firstName).toBe(current.firstName);
      expect(after.isActive).toBe(true);
    } finally {
      await shop.scope.cleanup([stranger], []);
    }
  });

  test('the monthly workbook of a limited manager holds nothing from another branch', async ({}, testInfo) => {
    const shop = world!;
    const now = new Date();
    const query = `year=${now.getFullYear()}&month=${now.getMonth() + 1}`;

    // The owner builds the file while working in branch B, then the limited manager of branch A asks for it.
    const byOwner = await shop.scope.asOwner('POST', `reports/monthly-workbook/generate?${query}`, { headers: inBranch(shop.branchB.id) });
    expect(byOwner.status(), await byOwner.text()).toBe(200);

    const byManager = await shop.scope.callAs(shop.manager, 'POST', `reports/monthly-workbook/generate?${query}`);
    const download = await shop.scope.callAs(shop.manager, 'GET', `reports/monthly-workbook/download?${query}`);
    expect([200, 403, 404]).toContain(download.status());
    expect(byManager.status()).toBeLessThan(500);

    if (download.status() === 200) {
      const file = testInfo.outputPath('manager-workbook.xlsx');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await download.body());
      const text = readXlsxStrings(file);
      expect(text).not.toContain(shop.drinkB.name);
      expect(text).not.toContain(shop.branchB.name);
    }
  });
});
