import { expect, test } from '@fixtures/index';
import { WASTE_REASON_NAMES, WasteReason } from '@data/enums';
import { PosWasteSheet } from '@pages/pos-waste-sheet.page';
import { RecordWasteDialog } from '@pages/record-waste-dialog.page';

test.describe('quick waste entry at the register @waste @pos', () => {
  test('a cashier records waste from the orders screen', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const page = await signIn('cashier', { landing: true });
    const sheet = new PosWasteSheet(page);
    const dialog = new RecordWasteDialog(page);

    await sheet.openOrders();
    await sheet.openButton.click();
    await sheet.search.fill(item.name);
    await sheet.item(item.name).click();
    await dialog.fill(4, WASTE_REASON_NAMES[WasteReason.StaffMeal]);
    await dialog.submit();

    await expect(dialog.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(36);
    const entries = await api.waste.list(`itemId=${item.id}`);
    expect(entries.items).toHaveLength(1);
  });

  test('an item with nothing left shows as out of stock in the sheet', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 0 });
    const page = await signIn('cashier', { landing: true });
    const sheet = new PosWasteSheet(page);

    await sheet.openOrders();
    await sheet.openButton.click();
    await sheet.search.fill(item.name);
    await expect(sheet.item(item.name)).toContainText('0');
  });

  test('a viewer has no Record Waste button and the API refuses', async ({ api, signIn }) => {
    const item = await api.items.create();
    const page = await signIn('viewer', { landing: true });
    const sheet = new PosWasteSheet(page);

    await sheet.openOrders();
    await expect(sheet.openButton).toHaveCount(0);
    const response = await api.waste.recordRaw(item.id, { quantity: 1 }, 'viewer');
    expect(response.status()).toBe(403);
  });

  test('two registers wasting the last units never take the balance below zero on a blocking item', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 5, allowNegativeStock: false });
    const results = await Promise.all([
      api.waste.recordRaw(item.id, { quantity: 4 }, 'cashier'),
      api.waste.recordRaw(item.id, { quantity: 4 }, 'admin'),
    ]);

    expect(results.filter((response) => response.ok())).toHaveLength(1);
    expect(await api.items.balance(item.id)).toBe(1);
  });
});
