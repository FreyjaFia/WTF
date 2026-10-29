import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { ItemDetailsPage } from '@pages/item-details.page';
import { StockAdjustDialog } from '@pages/stock-adjust-dialog.page';
import { StockInPage } from '@pages/stock-in.page';

test.describe('stock in, adjustments and the item pages @stock @items', () => {
  test('receiving stock raises the balance and shows under Added just now', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10 });
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);

    await stockIn.open(item.id);
    await expect(stockIn.summaryItem).toHaveText(item.name);
    await stockIn.quantity.fill('15');
    await expect(stockIn.balanceAfter).toContainText('25');
    await stockIn.submit.click();

    await expect(stockIn.recent).toContainText(item.name);
    await expect.poll(() => api.items.balance(item.id)).toBe(25);
  });

  test('an item can be picked from the grid by searching', async ({ api, signIn }) => {
    const item = await api.items.create();
    const page = await signIn('admin');
    const stockIn = new StockInPage(page);

    await stockIn.open();
    await stockIn.search.fill(item.name);
    await stockIn.tile(item.name).click();
    await expect(stockIn.summaryItem).toHaveText(item.name);
  });

  test('a stock manager can pick items on Stock In', async ({ api, signIn }) => {
    const item = await api.items.create();
    const page = await signIn('stockmgr');
    const stockIn = new StockInPage(page);

    await stockIn.open(item.id);
    await expect(stockIn.summaryItem).toHaveText(item.name);
  });

  test('stock in is refused for an item manager', async ({ api }) => {
    const item = await api.items.create();
    const response = await api.client.call('itemmgr', 'POST', `items/${item.id}/stock`, {
      body: { itemId: item.id, quantity: 1 },
    });
    expect(response.status()).toBe(403);
  });

  test('a count correction sets the balance and writes a history row', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 50 });
    const page = await signIn('admin');
    const details = new ItemDetailsPage(page);
    const adjust = new StockAdjustDialog(page);

    await details.open(item.id);
    await adjust.opener.click();
    await adjust.chooseMode('I counted');
    await adjust.quantity.fill('42');
    await expect(adjust.difference).toContainText('8');
    await adjust.reason.selectOption({ index: 0 });
    await adjust.save.click();

    await expect(adjust.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(42);
    await expect(details.movements.filter({ hasText: 'Adjustment' }).first()).toBeVisible();
  });

  test('an inactive item offers no Adjust Stock button', async ({ api, signIn }) => {
    const item = await api.items.create();
    await api.items.remove(item.id);
    const page = await signIn('admin');
    const details = new ItemDetailsPage(page);
    const adjust = new StockAdjustDialog(page);

    await details.open(item.id);
    await expect(adjust.opener).toHaveCount(0);
  });

  test('the item list opens an item from its row', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 7 });
    const page = await signIn('admin');

    await page.goto(ROUTES.items);
    await page.getByPlaceholder(/search/i).and(page.locator('input')).first().fill(item.name);
    await page.getByLabel(`View details for ${item.name}`).first().click();
    await expect(page).toHaveURL(new RegExp(`/inventory/items/details/${item.id}$`));
  });
});
