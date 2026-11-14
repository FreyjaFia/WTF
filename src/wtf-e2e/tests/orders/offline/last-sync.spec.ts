import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { expect, test } from '@fixtures/index';
import { LastSyncPage } from '@pages/last-sync.page';
import { OrderEditorPage } from '@pages/order-editor.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { changeSyncAnswers, SyncResult } from '@utils/sync-stub';

const SYNC_TIMEOUT_MS = 90_000;
const STOCK_NOTE = 'Oat milk went below zero after this sale.';
// Set E2E_SHOT_DIR to keep the screenshots of the card; without it nothing is written.
const SHOT_DIR: string | undefined = process.env.E2E_SHOT_DIR;

async function stockedDrink(api: Api, price: number = 100) {
  const drink = await api.products.create({ price });
  const item = await api.items.create({ startingQuantity: 20 });
  await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
  return { drink, item };
}

async function readyToSellOffline(editor: OrderEditorPage, productName: string): Promise<void> {
  await editor.search.fill(productName);
  await expect(editor.product(productName)).toBeVisible();
}

const HELD = 6;

// What the new API adds: the structured reasons. A held order gets its real reason as a Hold and a stock note; a saved
// one gets the stock note.
function withReasonDetails(results: SyncResult[]): SyncResult[] {
  return results.map((result) => {
    if (result.error) {
      return result;
    }

    const holds = result.status === HELD ? result.reasons.map((text) => ({ code: 'PriceChanged', severity: 'Hold' as const, text })) : [];
    const notes = [{ code: 'StockShortfall', severity: 'Note' as const, text: STOCK_NOTE }];
    return { ...result, reasons: [...result.reasons, STOCK_NOTE], reasonDetails: [...holds, ...notes] };
  });
}

test.describe('what the cashier is told after a sync @orders @offline', () => {
  test.setTimeout(180_000);

  test('a sale saved with a note says so, and the order carries the time of the last catalog update', async ({ api, signIn }) => {
    const { drink } = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    const lastSync = new LastSyncPage(page);
    const spy = await changeSyncAnswers(page, withReasonDetails);
    await editor.open();
    const openedAt = Date.now();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await page.context().setOffline(false);

    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    const [saved] = await api.orders.withStatusContaining(OrderStatus.Completed, drink.id);
    const row = lastSync.row(`Saved as order #${saved.orderNumber} with a note`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(STOCK_NOTE);
    await expect(lastSync.pendingTitle).toHaveCount(0);

    const [sentOrder] = spy.sent.flat();
    const catalogTime = Date.parse(String(sentOrder['catalogSyncedAt']));
    expect(catalogTime).toBeGreaterThan(openedAt - 120_000);
    expect(catalogTime).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  test('a held sale is told as sent to an Admin, with its reason, and the card cannot approve', async ({ api, signIn }) => {
    const { drink } = await stockedDrink(api, 100);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    const lastSync = new LastSyncPage(page);
    await changeSyncAnswers(page, withReasonDetails);
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await api.products.setPrice(drink.id, 120);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await page.context().setOffline(false);

    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    const [held] = await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id);
    const row = lastSync.row(`Order #${held.orderNumber} sent for review`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('listitem')).toHaveCount(1);
    await expect(row.getByRole('button')).toHaveCount(1);
    await expect(row.getByRole('button', { name: /approve|reject/i })).toHaveCount(0);
    await expect(row).not.toContainText(STOCK_NOTE);
  });

  test('a result stays on the device across a reload until it is dismissed, and Clear all removes the rest', async ({ api, signIn }) => {
    const first = await stockedDrink(api);
    const second = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    const lastSync = new LastSyncPage(page);
    await editor.open();

    await readyToSellOffline(editor, first.drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(first.drink.name);
    await editor.payCash(100);
    await lastSync.newOrder.click();
    await editor.search.waitFor();
    await editor.addProduct(second.drink.name);
    await editor.payCash(100);
    await page.context().setOffline(false);

    await expect(lastSync.rows).toHaveCount(2, { timeout: SYNC_TIMEOUT_MS });
    await expect(lastSync.rows.first()).toContainText('Saved as order #');

    await page.reload();
    await expect(lastSync.rows).toHaveCount(2);

    await lastSync.dismiss(lastSync.rows.first());
    await expect(lastSync.rows).toHaveCount(1);
    await page.reload();
    await expect(lastSync.rows).toHaveCount(1);

    await lastSync.clearAll.click();
    await expect(lastSync.card).toHaveCount(0);
    await page.reload();
    await expect(lastSync.card).toHaveCount(0);
  });

  test('an order the server could not save says why, and the result is replaced when it is saved on the next try', async ({ api, signIn }) => {
    const { drink } = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    const lastSync = new LastSyncPage(page);
    const spy = await changeSyncAnswers(page, (results) =>
      results.map((result) => ({ ...result, orderId: null, orderNumber: null, status: null, error: 'Latte is not sold here.' })),
    );
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await page.context().setOffline(false);

    const failed = lastSync.row('Could not sync');
    await expect(failed).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
    await expect(failed).toContainText('Latte is not sold here.');
    await expect(lastSync.pendingTitle).toBeVisible();
    // The stub only changes what the app is told. The shop did save the order, so trying again must not save it twice.
    await spy.release();
    await page.getByRole('button', { name: 'Sync Now' }).click();

    await expect(lastSync.row('Saved as order #')).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
    await expect(lastSync.rows).toHaveCount(1);
    await expect(lastSync.pendingTitle).toHaveCount(0);
    expect(await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).toHaveLength(1);
  });

  test('the card fits at phone, tablet and desktop widths', async ({ api, signIn }) => {
    const heldSale = await stockedDrink(api, 100);
    const savedSale = await stockedDrink(api, 80);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    const lastSync = new LastSyncPage(page);
    await changeSyncAnswers(page, withReasonDetails);
    await editor.open();

    await readyToSellOffline(editor, heldSale.drink.name);
    await api.products.setPrice(heldSale.drink.id, 120);
    await page.context().setOffline(true);
    await editor.addProduct(heldSale.drink.name);
    await editor.payCash(100);
    await lastSync.newOrder.click();
    await editor.search.waitFor();
    await editor.addProduct(savedSale.drink.name);
    await editor.payCash(80);
    await page.context().setOffline(false);

    await expect(lastSync.rows).toHaveCount(2, { timeout: SYNC_TIMEOUT_MS });
    await expect(lastSync.row('sent for review')).toBeVisible();
    await expect(lastSync.row('with a note')).toBeVisible();

    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
    }

    for (const viewport of VIEWPORTS) {
      // Tall enough that the card shows every row without its own scrollbar.
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 1400) });
      await expect(lastSync.card).toBeVisible();
      expect(overflowProblem(await measureOverflow(page)), viewport.name).toBeNull();

      const box = await lastSync.card.boundingBox();
      expect(box!.x + box!.width, `${viewport.name}: the card stays inside the window`).toBeLessThanOrEqual(viewport.width);

      if (SHOT_DIR) {
        await lastSync.card.screenshot({ path: join(SHOT_DIR, `last-sync-${viewport.width}.png`) });
      }
    }
  });
});
