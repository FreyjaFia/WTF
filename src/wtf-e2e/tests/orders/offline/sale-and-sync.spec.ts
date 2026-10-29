import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { expect, test } from '@fixtures/index';
import { OrderEditorPage } from '@pages/order-editor.page';

const SYNC_TIMEOUT_MS = 90_000;

async function stockedDrink(api: Api, price: number = 100) {
  const drink = await api.products.create({ price });
  const item = await api.items.create({ startingQuantity: 20 });
  await api.items.linkProducts(item.id, [{ productId: drink.id, quantityPerSale: 3 }]);
  return { drink, item };
}

// The register keeps its product list on the device only after it has loaded it, so wait for the product to show
// while still online; then it can be sold without a connection.
async function readyToSellOffline(editor: OrderEditorPage, productName: string): Promise<void> {
  await editor.search.fill(productName);
  await expect(editor.product(productName)).toBeVisible();
}

test.describe('selling without a connection and syncing later @orders @offline', () => {
  // Waiting for the auto-sync after the connection returns can take well over the normal test limit.
  test.setTimeout(150_000);

  test('a sale made offline is saved on the device, then syncs by itself when the connection returns', async ({ api, signIn }) => {
    const { drink, item } = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);

    // The shop has not heard about the sale yet.
    expect(await api.items.balance(item.id)).toBe(20);
    expect(await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).toHaveLength(0);

    await page.context().setOffline(false);

    await expect.poll(() => api.items.balance(item.id), { timeout: SYNC_TIMEOUT_MS }).toBe(17);
    const saved = await api.orders.withStatusContaining(OrderStatus.Completed, drink.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].totalAmount).toBe(100);
  });

  test('two sales made offline are each saved once, never twice', async ({ api, signIn }) => {
    const { drink, item } = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    // After a sale the app shows the orders list; start the next sale from there (the page cannot be reloaded offline).
    await page.getByRole('button', { name: 'New Order' }).or(page.getByRole('link', { name: 'New Order' })).locator('visible=true').first().click();
    await editor.search.waitFor();
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await page.context().setOffline(false);

    await expect.poll(() => api.items.balance(item.id), { timeout: SYNC_TIMEOUT_MS }).toBe(14);
    // Give a second, repeated sync time to misbehave before counting.
    await page.waitForTimeout(8_000);
    expect(await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).toHaveLength(2);
    expect(await api.items.balance(item.id)).toBe(14);
  });

  test('an offline sale at an old price is held for an Admin and takes no stock until approved', async ({ api, signIn }) => {
    const { drink, item } = await stockedDrink(api, 100);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await api.products.setPrice(drink.id, 120);
    await page.context().setOffline(false);

    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    const [held] = await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id);
    expect(held.totalAmount).toBe(100);
    expect(await api.items.balance(item.id)).toBe(20);
    expect(await api.orders.withStatusContaining(OrderStatus.Completed, drink.id)).toHaveLength(0);

    expect((await api.orders.approveHeld(held.id, 'cashier')).status()).toBe(403);

    expect((await api.orders.approveHeld(held.id, 'admin')).ok()).toBeTruthy();
    const approved = await api.orders.get(held.id);
    expect(approved.status).toBe(OrderStatus.Completed);
    expect(approved.totalAmount).toBe(100);
    expect(await api.items.balance(item.id)).toBe(17);
  });

  test('an offline sale of a product that was deleted meanwhile is held, not lost', async ({ api, signIn }) => {
    const { drink, item } = await stockedDrink(api);
    const page = await signIn('cashier');
    const editor = new OrderEditorPage(page);
    await editor.open();

    await readyToSellOffline(editor, drink.name);
    await page.context().setOffline(true);
    await editor.addProduct(drink.name);
    await editor.payCash(100);
    await api.products.remove(drink.id);
    await page.context().setOffline(false);

    await expect
      .poll(async () => (await api.orders.withStatusContaining(OrderStatus.PendingReview, drink.id)).length, { timeout: SYNC_TIMEOUT_MS })
      .toBe(1);
    expect(await api.items.balance(item.id)).toBe(20);
  });
});
