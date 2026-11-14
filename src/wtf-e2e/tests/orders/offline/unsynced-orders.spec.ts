import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { Api } from '@api/index';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { testPassword } from '@data/env';
import { USERNAMES } from '@data/users';
import { expect, test } from '@fixtures/index';
import { LoginPage } from '@pages/login.page';
import { UnsyncedOrdersPage } from '@pages/unsynced-orders.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_UNSYNCED_SHOTS_DIR ?? '/mnt/project-files/offline-phase-7/unsynced';
const NOT_FOUND = 'One or more selected products/add-ons were not found.';
const NOTE_HEADING = 'Unsynced offline sale recorded for the cash drawer';

interface UnsyncedRow {
  readonly id: string;
  readonly status: number;
  readonly resolution: number | null;
  readonly resultingOrderId: string | null;
  readonly discardReason: string | null;
  readonly errorText: string;
  readonly cashierName: string | null;
}

interface UnsyncedList {
  readonly totalCount: number;
  readonly items: readonly UnsyncedRow[];
}

// Sends an order the register sold offline through the real sync endpoint. The product does not exist, so the server
// cannot save it and keeps it for an Admin.
async function failingSale(api: Api, price: number = 100): Promise<string> {
  const localId = unique('OFF');
  const response = await api.client.call('cashier', 'POST', 'orders/sync', {
    body: {
      orders: [
        {
          status: OrderStatus.Completed,
          items: [
            { productId: randomUUID(), quantity: 2, addOns: [], quotedPrice: price / 2 },
          ],
          offlineLocalId: localId,
          createdAt: new Date().toISOString(),
          paymentMethod: PaymentMethod.Cash,
          amountReceived: price + 50,
          expectedTotal: price,
        },
      ],
    },
  });
  const [result] = await response.json();
  expect(result.error, 'the sync must refuse the order').toBe(NOT_FOUND);
  return localId;
}

async function rowFor(api: Api, localId: string): Promise<UnsyncedRow> {
  const list = await api.client.json<UnsyncedList>('admin', 'GET', `orders/unsynced?searchTerm=${encodeURIComponent(localId)}`);
  expect(list.totalCount).toBe(1);
  return list.items[0];
}

test.describe('Unsynced orders @orders @offline', () => {
  test.setTimeout(120_000);

  test('an order the server cannot save is listed for an Admin with its quoted lines and error', async ({ api, signIn }) => {
    const localId = await failingSale(api, 100);
    const row = await rowFor(api, localId);
    expect(row.status).toBe(1);
    expect(row.errorText).toBe(NOT_FOUND);
    expect(row.cashierName).toBeTruthy();

    const page = await signIn('admin');
    const unsynced = new UnsyncedOrdersPage(page);
    await unsynced.open();
    await unsynced.find(localId);
    await expect(unsynced.row(localId)).toHaveCount(1);
    await expect(unsynced.row(localId)).toContainText(NOT_FOUND);
    await expect(unsynced.row(localId)).toContainText('100.00');

    await unsynced.row(localId).click();
    await expect(unsynced.detail).toContainText('Why it was not saved');
    await expect(unsynced.detail).toContainText(NOT_FOUND);
    await expect(unsynced.detail).toContainText('2 ×');
    await expect(unsynced.detail).toContainText('Unknown product');
    await expect(unsynced.detail).toContainText('Cash');
    await expect(unsynced.retry).toBeVisible();
    await expect(unsynced.saveAsNote).toBeVisible();
    await expect(unsynced.discard).toBeVisible();
  });

  test('a retry that still cannot save keeps the order open and shows the error', async ({ api, signIn }) => {
    const localId = await failingSale(api);
    const page = await signIn('admin');
    const unsynced = new UnsyncedOrdersPage(page);
    await unsynced.open();
    await unsynced.openRow(localId);

    await unsynced.retry.click();
    await expect(unsynced.confirm).toContainText('Retry this order?');
    await unsynced.confirmButton('Retry').click();

    await expect(unsynced.confirm).toHaveCount(0);
    await expect(unsynced.detail).toContainText(NOT_FOUND);
    await expect(unsynced.retry).toBeVisible();
    expect((await rowFor(api, localId)).status).toBe(1);
    const orders = await api.client.json<readonly { offlineLocalId?: string }[]>('admin', 'GET', 'orders');
    expect(orders.some((order) => order.offlineLocalId === localId)).toBe(false);
  });

  test('saving as a note keeps a cancelled record with the total and the cash, and is not a sale', async ({ api, signIn }) => {
    const localId = await failingSale(api, 100);
    const page = await signIn('admin');
    const unsynced = new UnsyncedOrdersPage(page);
    await unsynced.open();
    await unsynced.openRow(localId);

    await unsynced.saveAsNote.click();
    await expect(unsynced.confirm).toContainText('does not count as a sale');
    await unsynced.confirmButton('Save as note').click();

    await expect(unsynced.row(localId)).toHaveCount(0);
    const row = await api.client.json<{ order: UnsyncedRow }>('admin', 'GET', `orders/unsynced/${(await listedId(api, localId))}`);
    expect(row.order.status).toBe(2);
    expect(row.order.resolution).toBe(2);
    const saved = await api.client.json<{ status: number; note: string; quotedTotal: number; amountReceived: number; items: unknown[] }>(
      'admin',
      'GET',
      `orders/${row.order.resultingOrderId}`,
    );
    expect(saved.status).toBe(OrderStatus.Cancelled);
    expect(saved.note).toContain(NOTE_HEADING);
    expect(saved.note).toContain(localId);
    expect(saved.quotedTotal).toBe(100);
    expect(saved.amountReceived).toBe(150);
    expect(saved.items).toHaveLength(0);
  });

  test('discarding needs a reason, and keeps it', async ({ api, signIn }) => {
    const localId = await failingSale(api);
    const page = await signIn('admin');
    const unsynced = new UnsyncedOrdersPage(page);
    await unsynced.open();
    await unsynced.openRow(localId);

    await unsynced.discard.click();
    await unsynced.confirmButton('Discard').click();
    await expect(unsynced.reasonError).toContainText('reason');
    expect((await rowFor(api, localId)).status).toBe(1);

    await unsynced.reason.fill('Test sale, no money was taken.');
    await unsynced.confirmButton('Discard').click();

    await expect(unsynced.row(localId)).toHaveCount(0);
    const row = await rowFor(api, localId);
    expect(row.status).toBe(2);
    expect(row.resolution).toBe(3);
    expect(row.discardReason).toBe('Test sale, no money was taken.');
    expect(row.resultingOrderId).toBeNull();
  });

  test('a resolved order stays listed under Resolved, without actions', async ({ api, signIn }) => {
    const localId = await failingSale(api);
    const id = await listedId(api, localId);
    await api.client.call('admin', 'POST', `orders/unsynced/${id}/discard`, { body: { reason: 'Duplicate of a paper receipt' } });
    const page = await signIn('admin');
    const unsynced = new UnsyncedOrdersPage(page);
    await unsynced.open();

    await unsynced.find(localId, 0);
    await unsynced.filtersButton.click();
    await unsynced.filtersDrawer.getByRole('radio').nth(1).check();
    await unsynced.filtersDrawer.getByRole('button', { name: 'Close filters' }).click();
    await unsynced.row(localId).click();

    await expect(unsynced.detail).toContainText('Discarded');
    await expect(unsynced.detail).toContainText('Duplicate of a paper receipt');
    await expect(unsynced.actions).toHaveCount(0);
  });

  test('a Cashier and an Admin Viewer cannot read or act on unsynced orders', async ({ api, signIn }) => {
    const localId = await failingSale(api);
    const id = await listedId(api, localId);

    for (const role of ['cashier', 'viewer'] as const) {
      expect((await api.client.call(role, 'GET', 'orders/unsynced')).status(), `${role} list`).toBe(403);
      expect((await api.client.call(role, 'GET', `orders/unsynced/${id}`)).status(), `${role} read`).toBe(403);
      expect((await api.client.call(role, 'POST', `orders/unsynced/${id}/retry`)).status(), `${role} retry`).toBe(403);
      expect((await api.client.call(role, 'POST', `orders/unsynced/${id}/note-only`)).status(), `${role} note`).toBe(403);
      expect((await api.client.call(role, 'POST', `orders/unsynced/${id}/discard`, { body: { reason: 'x' } })).status(), `${role} discard`).toBe(403);

      const page = await signIn(role);
      await page.goto('/orders/unsynced', { waitUntil: 'commit' });
      await page.waitForURL((url) => !url.pathname.startsWith('/orders/unsynced'));
      await expect(page.getByRole('heading', { name: 'Unsynced Orders', exact: true })).toHaveCount(0);
    }

    expect((await rowFor(api, localId)).status).toBe(1);
  });

  test('the Admin sees the Management card and the Admin Viewer does not', async ({ signIn }) => {
    const admin = await signIn('admin');
    await admin.goto('/management', { waitUntil: 'commit' });
    await expect(admin.getByTestId('management-card-unsynced-orders')).toBeVisible();

    const viewer = await signIn('viewer');
    await viewer.goto('/management', { waitUntil: 'commit' });
    await expect(viewer.getByTestId('management-card-expenses')).toBeVisible();
    await expect(viewer.getByTestId('management-card-unsynced-orders')).toHaveCount(0);
  });

  test('the order list tells an Admin how many orders could not be saved', async ({ api, signIn }) => {
    await failingSale(api);
    const admin = await signIn('admin');
    await admin.goto('/orders/list', { waitUntil: 'commit' });
    const banner = admin.locator('[data-unsynced-banner]');
    await expect(banner).toContainText(/unsynced orders? could not be saved/);
    await banner.click();
    await expect(admin).toHaveURL(/\/orders\/unsynced$/);

    const cashier = await signIn('cashier');
    await cashier.goto('/orders/list', { waitUntil: 'commit' });
    await expect(cashier.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
    await expect(cashier.locator('[data-unsynced-banner]')).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`the list, the filters and the detail fit at ${viewport.name}`, async ({ api, newContext }) => {
      const localId = await failingSale(api, 245.5);
      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(USERNAMES.admin, testPassword());
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const unsynced = new UnsyncedOrdersPage(page);
      await unsynced.open();
      await unsynced.find(localId);
      await expect(unsynced.row(localId)).toHaveCount(1);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      const tag = String(viewport.width);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/list-${tag}.png` });

      await unsynced.filtersButton.click();
      await expect(unsynced.filtersDrawer).toBeInViewport();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/filters-${tag}.png` });
      await unsynced.filtersDrawer.getByRole('button', { name: 'Close filters' }).click();
      await page.waitForTimeout(400);

      await unsynced.row(localId).click();
      await unsynced.detail.waitFor();
      await expect(unsynced.retry).toBeInViewport();
      await expect(unsynced.discard).toBeInViewport();
      await page.waitForTimeout(400);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `${SHOTS}/detail-${tag}.png` });

      await unsynced.discard.click();
      await expect(unsynced.confirm).toBeVisible();
      const box = await unsynced.confirm.getByRole('document').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `${SHOTS}/discard-${tag}.png` });
    });
  }
});

async function listedId(api: Api, localId: string): Promise<string> {
  return (await rowFor(api, localId)).id;
}
