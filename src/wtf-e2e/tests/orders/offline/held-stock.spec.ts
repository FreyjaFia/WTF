import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { expect, test } from '@fixtures/index';
import { OrderDetailsPage } from '@pages/order-details.page';
import { OrderEditorPage } from '@pages/order-editor.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';

const SYNC_TIMEOUT_MS = 90_000;
// Set E2E_SHOT_DIR to keep the screenshots of the review box; without it nothing is written.
const SHOT_DIR: string | undefined = process.env.E2E_SHOT_DIR;

async function stockedDrink(api: Api, startingQuantity: number, price: number = 100) {
  const drink = await api.products.create({ price });
  const item = await api.items.create({ startingQuantity });
  await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
  return { drink, item };
}

async function sellOffline(page: Page, productName: string, beforeSale: () => Promise<void> = async () => undefined): Promise<void> {
  const editor = new OrderEditorPage(page);
  await editor.open();
  await editor.search.fill(productName);
  await expect(editor.product(productName)).toBeVisible();
  await beforeSale();
  await page.context().setOffline(true);
  await editor.addProduct(productName);
  await editor.payCash(100);
  await page.context().setOffline(false);
}

test.describe('stock and a held offline sale @orders @offline @inventory', () => {
  test.setTimeout(180_000);

  async function heldSale(api: Api, signIn: (role: 'cashier') => Promise<Page>) {
    const { drink, item } = await stockedDrink(api, 20);
    const page = await signIn('cashier');
    await sellOffline(page, drink.name, () => api.products.setPrice(drink.id, 120));
    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    const [held] = await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id);
    expect(await api.items.balance(item.id)).toBe(20);
    return { drink, item, held };
  }

  test('rejecting a held sale with waste counts what it used as waste', async ({ api, signIn }) => {
    const { item, held } = await heldSale(api, signIn);
    const admin = await signIn('admin');
    const details = new OrderDetailsPage(admin);
    await details.openHeld(held.id);
    await expect(details.heldBox).toContainText('Needs review');

    await details.rejectHeld('Wrong price, goods were handed over', 'waste');

    await expect(admin.getByText(`Order #${held.orderNumber} rejected.`)).toBeVisible();
    expect((await api.orders.get(held.id)).status).toBe(OrderStatus.Cancelled);
    expect(await api.items.balance(item.id)).toBe(17);
    const movements = await api.items.movements(item.id);
    expect(movements.some((m) => (m.movementType ?? m.type) === 'Waste' && m.quantityDelta === -3)).toBe(true);
  });

  test('rejecting without choosing waste leaves the stock alone', async ({ api, signIn }) => {
    const { item, held } = await heldSale(api, signIn);
    const admin = await signIn('admin');
    const details = new OrderDetailsPage(admin);
    await details.openHeld(held.id);
    await expect(details.stockAfterRejecting).toHaveValue('none');

    await details.rejectHeld('Wrong price', 'none');

    await expect(admin.getByText(`Order #${held.orderNumber} rejected.`)).toBeVisible();
    expect((await api.orders.get(held.id)).status).toBe(OrderStatus.Cancelled);
    expect(await api.items.balance(item.id)).toBe(20);
    expect(await api.items.movements(item.id)).toHaveLength(1);
  });

  test('a cashier does not see the stock choice, and the review box fits at every width', async ({ api, signIn }) => {
    const { held } = await heldSale(api, signIn);
    const cashier = await signIn('cashier');
    await new OrderDetailsPage(cashier).openHeld(held.id);
    await expect(cashier.locator('[data-held-order]')).toContainText('An Admin has to approve or reject it.');
    await expect(cashier.locator('#stock-after-rejecting')).toHaveCount(0);

    const admin = await signIn('admin');
    const details = new OrderDetailsPage(admin);
    await details.openHeld(held.id);
    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
    }

    for (const viewport of VIEWPORTS) {
      await admin.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 1200) });
      await expect(details.stockAfterRejecting).toBeVisible();
      expect(overflowProblem(await measureOverflow(admin)), viewport.name).toBeNull();
      const box = await details.heldBox.boundingBox();
      expect(box!.x + box!.width, `${viewport.name}: the box stays inside the window`).toBeLessThanOrEqual(viewport.width);
      if (SHOT_DIR) {
        await details.heldBox.screenshot({ path: join(SHOT_DIR, `review-box-${viewport.width}.png`) });
      }
    }
  });

  test('a sale that runs the item below zero is saved, with a stock note and the item negative', async ({ api, signIn }) => {
    const { drink, item } = await stockedDrink(api, 2);
    const page = await signIn('cashier');
    await sellOffline(page, drink.name);
    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    const [saved] = await api.orders.withStatusContaining(OrderStatus.Completed, drink.id);
    expect(await api.items.balance(item.id)).toBe(-1);

    const admin = await signIn('admin');
    const details = new OrderDetailsPage(admin);
    await details.open(saved.id);
    await expect(details.notes.first()).toContainText(`${item.name} ran short`);
    await expect(admin.locator('[data-held-order]')).toHaveCount(0);

    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
    }

    for (const viewport of VIEWPORTS) {
      await admin.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, 1200) });
      expect(overflowProblem(await measureOverflow(admin)), viewport.name).toBeNull();
      if (SHOT_DIR) {
        await details.notes.first().screenshot({ path: join(SHOT_DIR, `stock-note-${viewport.width}.png`) });
      }
    }
  });
});
