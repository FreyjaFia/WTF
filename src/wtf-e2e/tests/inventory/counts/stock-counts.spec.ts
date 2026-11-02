import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { Role } from '@data/users';

interface CountSummary {
  readonly id: string;
  readonly status: number;
  readonly countedCount: number;
}

interface CountLine {
  readonly itemId: string;
  readonly expectedQuantity: number | null;
  readonly countedQuantity: number | null;
  readonly difference: number | null;
}

interface Count {
  readonly summary: CountSummary;
  readonly lines: readonly CountLine[];
}

const POSTED = 2;
const CANCELLED = 3;

async function startCount(api: Api, itemId: string, isBlind: boolean = false, role: Role = 'superadmin'): Promise<Count> {
  return api.client.json<Count>(role, 'POST', 'stock-counts', {
    name: `E2E count ${Date.now()}`,
    isBlind,
    note: null,
    itemIds: [itemId],
  });
}

async function saveLine(api: Api, countId: string, itemId: string, countedQuantity: number | null): Promise<Count> {
  return api.client.json<Count>('superadmin', 'PUT', `stock-counts/${countId}/lines`, {
    lines: [{ itemId, countedQuantity }],
  });
}

test.describe('stock counts @inventory @counts', () => {
  test('posting writes the difference on top of the balance at that moment', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 200 });
    const count = await startCount(api, item.id);
    await saveLine(api, count.summary.id, item.id, 185);

    await api.items.stockIn(item.id, 10);
    const response = await api.client.call('superadmin', 'POST', `stock-counts/${count.summary.id}/post`);
    expect(response.ok(), await response.text()).toBeTruthy();

    // Counted 185 against the 200 shown, so -15 is applied to the 210 now on hand.
    expect(await api.items.balance(item.id)).toBe(195);
  });

  test('an item left empty is not touched, and a posted count cannot change', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 50 });
    const other = await api.items.create({ startingQuantity: 70 });
    const count = await api.client.json<Count>('superadmin', 'POST', 'stock-counts', {
      name: `E2E count ${Date.now()}`,
      isBlind: false,
      note: null,
      itemIds: [item.id, other.id],
    });
    await saveLine(api, count.summary.id, item.id, 40);
    expect((await api.client.call('superadmin', 'POST', `stock-counts/${count.summary.id}/post`)).ok()).toBeTruthy();

    expect(await api.items.balance(item.id)).toBe(40);
    expect(await api.items.balance(other.id)).toBe(70);
    expect((await api.client.call('superadmin', 'POST', `stock-counts/${count.summary.id}/post`)).status()).toBe(400);
    expect((await api.client.call('superadmin', 'POST', `stock-counts/${count.summary.id}/cancel`)).status()).toBe(400);
  });

  test('a cancelled count changes no balance', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 30 });
    const count = await startCount(api, item.id);
    await saveLine(api, count.summary.id, item.id, 5);
    const cancelled = await api.client.json<Count>('superadmin', 'POST', `stock-counts/${count.summary.id}/cancel`);

    expect(cancelled.summary.status).toBe(CANCELLED);
    expect(await api.items.balance(item.id)).toBe(30);
  });

  test('a blind count hides the expected balance until it is posted', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 80 });
    const count = await startCount(api, item.id, true);
    expect(count.lines[0].expectedQuantity).toBeNull();

    await saveLine(api, count.summary.id, item.id, 78);
    const posted = await api.client.json<Count>('superadmin', 'POST', `stock-counts/${count.summary.id}/post`);
    expect(posted.summary.status).toBe(POSTED);
    expect(posted.lines[0].expectedQuantity).toBe(80);
    expect(posted.lines[0].difference).toBe(-2);
  });

  test('an empty name is refused', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 5 });
    const response = await api.client.call('superadmin', 'POST', 'stock-counts', {
      body: { name: '  ', isBlind: false, note: null, itemIds: [item.id] },
    });
    expect(response.status()).toBe(400);
  });

  for (const role of ['superadmin', 'admin', 'stockmgr'] as const) {
    test(`${role} can start a count`, async ({ api }) => {
      const item = await api.items.create({ startingQuantity: 5 });
      const count = await startCount(api, item.id, false, role);
      expect(count.summary.id).toBeTruthy();
    });
  }

  for (const role of ['cashier', 'itemmgr'] as const) {
    test(`${role} gets 403 on counts`, async ({ api }) => {
      expect((await api.client.call(role, 'GET', 'stock-counts')).status()).toBe(403);
      const start = await api.client.call(role, 'POST', 'stock-counts', { body: { name: 'x', isBlind: false, itemIds: [] } });
      expect(start.status()).toBe(403);
    });
  }

  test('a viewer can read counts but not start or post one', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 5 });
    const count = await startCount(api, item.id);
    expect((await api.client.call('viewer', 'GET', 'stock-counts')).status()).toBe(200);
    expect((await api.client.call('viewer', 'GET', `stock-counts/${count.summary.id}`)).status()).toBe(200);
    expect((await api.client.call('viewer', 'POST', `stock-counts/${count.summary.id}/post`)).status()).toBe(403);
    const start = await api.client.call('viewer', 'POST', 'stock-counts', {
      body: { name: 'x', isBlind: false, itemIds: [item.id] },
    });
    expect(start.status()).toBe(403);
  });

  test('the screen starts a count, saves progress and posts it', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 120 });
    const page = await signIn('admin');
    await page.goto(ROUTES.counts);

    await page.getByTestId('open-start').click();
    await page.getByLabel('Name', { exact: true }).fill(`E2E screen count ${Date.now()}`);
    await page.getByRole('button', { name: 'Start Count' }).last().click();
    await page.waitForURL(/\/inventory\/counts\/[0-9a-f-]{36}/);

    await page.getByRole('searchbox', { name: 'Search items in this count' }).fill(item.name);
    await page.getByLabel(`Counted quantity of ${item.name}`).fill('115');
    await page.getByRole('button', { name: 'Save Progress' }).click();
    await expect(page.getByText('Counted numbers saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Post Count' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Post Count' }).click();
    await expect(page.getByText('Posted').first()).toBeVisible();
    expect(await api.items.balance(item.id)).toBe(115);
  });

  for (const role of ['viewer', 'stockmgr'] as const) {
    test(`${role} sees the counts list; only roles that can write get Start Count`, async ({ signIn }) => {
      const page = await signIn(role);
      await page.goto(ROUTES.counts);
      await expect(page.getByRole('heading', { name: 'Stock Counts' })).toBeVisible();
      await expect(page.getByTestId('open-start')).toHaveCount(role === 'stockmgr' ? 1 : 0);
    });
  }

  test('the count sheet fits a phone screen', async ({ api, signIn }) => {
    const name = `C${'ideunbrokenname'.repeat(5)}${Date.now().toString(36)}`.slice(0, 95);
    const item = await api.items.create({ name, startingQuantity: 9 });
    const count = await startCount(api, item.id);
    const page = await signIn('admin');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTES.countById(count.summary.id));

    await expect(page.getByTestId('count-line').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
