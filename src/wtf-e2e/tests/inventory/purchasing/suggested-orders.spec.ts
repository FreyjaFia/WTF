import { PurchasingApi, asRole } from '@api/purchasing';
import { expect, test } from '@fixtures/index';
import { OrdersPage, SuggestedOrdersPage } from '@pages/purchasing.page';
import { ROUTES } from '@data/routes';

test.describe('par levels and the suggested orders view @inventory @suggested-orders', () => {
  test('an item below par is suggested in whole packs of its preferred supplier', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 10 });
    await buy.link(item.id, supplier.summary.id, { packName: 'carton', unitsPerPack: 12, packPrice: 840 });
    expect((await buy.setPar(item.id, 48)).ok()).toBeTruthy();

    const found = await buy.reorderLine(item.id);
    expect(found?.group.supplierId).toBe(supplier.summary.id);
    // 48 - 10 = 38 units, so 4 cartons (48 units).
    expect(found?.line).toMatchObject({ onHand: 10, parLevel: 48, onOrder: 0, suggestedUnits: 48, suggestedPacks: 4 });

    const page = await signIn('admin');
    const reorder = new SuggestedOrdersPage(page);
    await reorder.open();
    const group = reorder.group(supplier.summary.name);
    await expect(group).toBeVisible();
    await expect(group.getByTestId('reorder-line').filter({ hasText: item.name })).toContainText('4 carton');
    await expect(group).toContainText('3,360.00');
  });

  test('an item at or above par, or without a par, is left off the list', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const atPar = await buy.createItem({ startingQuantity: 24 });
    const noPar = await buy.createItem({ startingQuantity: 0 });
    await buy.link(atPar.id, supplier.summary.id);
    await buy.link(noPar.id, supplier.summary.id);
    await buy.setPar(atPar.id, 24);

    expect(await buy.reorderLine(atPar.id)).toBeNull();
    expect(await buy.reorderLine(noPar.id)).toBeNull();
  });

  test('an item without a supplier is listed under "No supplier set" in whole units', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const item = await buy.createItem({ startingQuantity: 3 });
    await buy.setPar(item.id, 10);

    const found = await buy.reorderLine(item.id);
    expect(found?.group.supplierId).toBeNull();
    expect(found?.line).toMatchObject({ suggestedUnits: 7, suggestedPacks: null });

    const page = await signIn('admin');
    const reorder = new SuggestedOrdersPage(page);
    await reorder.open();
    await expect(reorder.group('No supplier set').getByTestId('reorder-line').filter({ hasText: item.name })).toBeVisible();
    await expect(reorder.group('No supplier set').getByTestId('create-order')).toHaveCount(0);
  });

  test('a par level set on the page moves the item on and off the list', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 5 });
    await buy.link(item.id, supplier.summary.id);

    const page = await signIn('admin');
    const reorder = new SuggestedOrdersPage(page);
    await reorder.open();
    await reorder.parToggle.click();
    const input = reorder.parRow(item.name).locator('input');
    await expect(input).toHaveValue('');
    await expect(reorder.line(item.name)).toHaveCount(0);

    await input.fill('30');
    await input.blur();
    await expect(reorder.line(item.name)).toBeVisible();
    expect((await buy.reorderLine(item.id))?.line.parLevel).toBe(30);

    await input.fill('');
    await input.blur();
    await expect(reorder.line(item.name)).toHaveCount(0);
    expect(await buy.reorderLine(item.id)).toBeNull();
  });

  test('a negative par level is refused and nothing changes', async ({ api }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const item = await buy.createItem();
    await buy.setPar(item.id, 20);

    expect((await buy.setPar(item.id, -1)).status()).toBe(400);
    expect((await buy.setPar(crypto.randomUUID(), 5)).status()).toBe(404);
    expect(await buy.parLevel(item.id)).toBe(20);
  });

  test('a stock manager sees the list without any prices, and a cashier is refused', async ({ api, signIn }) => {
    const buy = new PurchasingApi(asRole(api.client));
    const supplier = await buy.createSupplier();
    const item = await buy.createItem({ startingQuantity: 0 });
    await buy.link(item.id, supplier.summary.id, { packPrice: 840 });
    await buy.setPar(item.id, 24);

    const list = await api.client.json<{ groups: { estimatedCost: number | null; lines: { itemId: string; packPrice: number | null; estimatedCost: number | null }[] }[] }>('stockmgr', 'GET', 'reorder');
    const line = list.groups.flatMap((g) => g.lines).find((l) => l.itemId === item.id);
    expect(line?.packPrice).toBeNull();
    expect(line?.estimatedCost).toBeNull();
    expect(list.groups.every((g) => g.estimatedCost === null)).toBe(true);
    expect((await api.client.call('cashier', 'GET', 'reorder')).status()).toBe(403);

    const page = await signIn('stockmgr');
    const reorder = new SuggestedOrdersPage(page);
    await reorder.open();
    await expect(reorder.group(supplier.summary.name)).not.toContainText('about');
  });

  test('Purchasing opens the suggestions through its button, and there is no Reorder entry', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.setViewportSize({ width: 390, height: 844 });
    const orders = new OrdersPage(page);
    await orders.open();

    await expect(page.locator('[role="tab"]')).toHaveCount(0);
    await expect(page.getByTestId('inventory-back')).toBeVisible();

    await page.getByTestId('open-suggestions').click();
    await expect(page).toHaveURL(/\/inventory\/purchase-orders\/suggestions$/);
    const suggested = new SuggestedOrdersPage(page);
    await expect(suggested.heading).toBeVisible();

    await page.getByTestId('suggestions-back').click();
    await expect(page).toHaveURL(/\/inventory\/purchase-orders$/);
    await expect(orders.heading).toBeVisible();
  });

  test('the old Reorder address leads to the suggestions', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.reorderLegacy);
    await expect(page).toHaveURL(/\/inventory\/purchase-orders\/suggestions$/);
    await expect(new SuggestedOrdersPage(page).heading).toBeVisible();
  });
});
