import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { WasteReason } from '@data/enums';
import { ROUTES } from '@data/routes';
import { today } from '@utils/dates';
import { captureDownload, readXlsxStrings } from '@utils/download';
import * as fs from 'fs';

interface VarianceRow {
  readonly itemId: string;
  readonly opening: number;
  readonly received: number;
  readonly theoreticalUsage: number;
  readonly waste: number;
  readonly corrections: number;
  readonly actualUsage: number;
  readonly closing: number;
  readonly variance: number;
  readonly variancePercent: number | null;
  readonly varianceValue: number | null;
  readonly status: string;
}

async function variance(api: Api, itemId: string, extra: string = ''): Promise<VarianceRow[]> {
  const date = today();
  return api.client.json<VarianceRow[]>(
    'superadmin',
    'GET',
    `reports/stock-variance?fromDate=${date}&toDate=${date}&itemId=${itemId}${extra}`,
  );
}

async function count(api: Api, itemId: string, counted: number): Promise<void> {
  const made = await api.client.json<{ summary: { id: string } }>('superadmin', 'POST', 'stock-counts', {
    name: `E2E variance ${Date.now()}`,
    isBlind: false,
    note: null,
    itemIds: [itemId],
  });
  await api.client.json<unknown>('superadmin', 'PUT', `stock-counts/${made.summary.id}/lines`, {
    lines: [{ itemId, countedQuantity: counted }],
  });
  await api.client.json<unknown>('superadmin', 'POST', `stock-counts/${made.summary.id}/post`);
}

test.describe('stock variance report @reports @counts', () => {
  test('sales, a refund, waste and a short count reconcile', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 1000, costPrice: 0.5 });
    const drink = await api.products.create({ price: 100 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 100 }]);

    await api.orders.create({ items: [{ productId: drink.id, quantity: 3 }] });
    const refunded = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    expect((await api.orders.voidOrder(refunded.id, 'E2E refund')).ok()).toBeTruthy();
    await api.waste.record(item.id, { quantity: 20, wasteReasonId: WasteReason.SpilledOrDropped });
    // The balance is 1000 - 300 - 100 + 100 - 20 = 680; the shelf shows 650.
    await count(api, item.id, 650);

    const row = (await variance(api, item.id))[0];
    expect(row.received).toBe(1000);
    expect(row.theoreticalUsage).toBe(300);
    expect(row.waste).toBe(20);
    expect(row.corrections).toBe(-30);
    expect(row.actualUsage).toBe(350);
    expect(row.closing).toBe(650);
    expect(row.opening + row.received - row.actualUsage).toBe(row.closing);
    expect(row.variance).toBe(30);
    expect(row.variancePercent).toBe(10);
    expect(row.varianceValue).toBe(15);
    expect(row.status).toBe('Check');
  });

  test('a small difference is OK within the tolerance and Check above it', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 1000 });
    const drink = await api.products.create({ price: 100 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 100 }]);
    await api.orders.create({ items: [{ productId: drink.id, quantity: 2 }] });
    await count(api, item.id, 795);

    expect((await variance(api, item.id, '&tolerancePercent=5'))[0].status).toBe('OK');
    expect((await variance(api, item.id, '&tolerancePercent=1'))[0].status).toBe('Check');
  });

  test('an item with no count is Not counted', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 100 });
    const drink = await api.products.create({ price: 100 });
    await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 10 }]);
    await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });

    const row = (await variance(api, item.id))[0];
    expect(row.status).toBe('Not counted');
    expect(row.theoreticalUsage).toBe(10);
  });

  test('a bad tolerance is refused', async ({ api }) => {
    const date = today();
    for (const value of ['-1', '101']) {
      const response = await api.client.call('admin', 'GET', `reports/stock-variance?fromDate=${date}&toDate=${date}&tolerancePercent=${value}`);
      expect(response.status()).toBe(400);
    }
  });

  for (const role of ['superadmin', 'admin', 'viewer'] as const) {
    test(`${role} opens the variance report on screen`, async ({ api, signIn }) => {
      const item = await api.items.create({ startingQuantity: 100 });
      await count(api, item.id, 90);
      const page = await signIn(role);
      await page.goto(ROUTES.report('stock-variance'));

      await expect(page.getByRole('heading', { name: 'Stock Variance' })).toBeVisible();
      await page.getByPlaceholder('Search all columns').fill(item.name);
      await expect(page.getByText(item.name).locator('visible=true').first()).toBeVisible();
      await expect(page.getByText('Check', { exact: true }).locator('visible=true').first()).toBeVisible();
    });
  }

  for (const role of ['cashier', 'stockmgr', 'itemmgr'] as const) {
    test(`${role} cannot read the variance report`, async ({ api }) => {
      const date = today();
      const response = await api.client.call(role, 'GET', `reports/stock-variance?fromDate=${date}&toDate=${date}`);
      expect(response.status()).toBe(403);
    });
  }

  test('the date filter on screen includes today and leaves out yesterday', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100 });
    await count(api, item.id, 90);
    const page = await signIn('admin');
    await page.goto(ROUTES.report('stock-variance'));
    await page.getByPlaceholder('Search all columns').fill(item.name);
    await expect(page.getByText(item.name).locator('visible=true').first()).toBeVisible();

    await page.getByLabel('Preset').selectOption({ label: 'Yesterday' });
    await expect(page.getByText(item.name).locator('visible=true')).toHaveCount(0);

    await page.getByLabel('Preset').selectOption({ label: 'Today' });
    await expect(page.getByText(item.name).locator('visible=true').first()).toBeVisible();
  });

  test('Excel and CSV from the screen hold the row and its figures', async ({ api, signIn }, info) => {
    const item = await api.items.create({ startingQuantity: 100, costPrice: 2 });
    await count(api, item.id, 90);
    const page = await signIn('admin');
    await page.goto(ROUTES.report('stock-variance'));
    await page.getByPlaceholder('Search all columns').fill(item.name);
    const exports = page.getByRole('group', { name: 'Export' });

    const excel = await captureDownload(page, info, () => exports.getByRole('button', { name: 'Excel' }).click());
    const cells = readXlsxStrings(excel.path);
    for (const text of ['Stock Variance', item.name, '90.00', '10.00', 'PHP 20.00', 'Check']) {
      expect(cells, text).toContain(text);
    }

    const csv = await captureDownload(page, info, () => exports.getByRole('button', { name: 'CSV' }).click());
    const lines = fs.readFileSync(csv.path, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line);
    expect(lines[0]).toContain('Variance Value');
    expect(lines.filter((line) => line.includes(item.name))).toHaveLength(1);
    expect(lines.find((line) => line.includes(item.name))).toContain('Check');
  });

  test('the report fits a phone screen', async ({ api, signIn }) => {
    const name = `V${'ideunbrokenname'.repeat(5)}${Date.now().toString(36)}`.slice(0, 95);
    const item = await api.items.create({ name, startingQuantity: 100 });
    await count(api, item.id, 90);
    const page = await signIn('admin');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTES.report('stock-variance'));

    await expect(page.getByRole('heading', { name: 'Stock Variance' })).toBeVisible();
    await page.getByPlaceholder('Search all columns').fill(name.slice(0, 30));
    await expect(page.getByText(name.slice(0, 20)).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
