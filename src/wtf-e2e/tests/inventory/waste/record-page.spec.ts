import { expect, test } from '@fixtures/index';
import { WASTE_REASON_NAMES, WasteReason } from '@data/enums';
import { ROUTES } from '@data/routes';
import { RecordWastePage } from '@pages/record-waste.page';
import { measureOverflow, overflowProblem, useStyle, VIEWPORTS } from '@utils/layout';

test.describe('record waste pages @waste', () => {
  test('a cashier picks an item, records waste on its own page and lands back on the picker', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const page = await signIn('cashier', { landing: true });
    const record = new RecordWastePage(page);

    await record.openPicker();
    await record.search.fill(item.name);
    await record.item(item.name).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.wasteRecordItem(item.id)}$`));
    await record.fill(4, WASTE_REASON_NAMES[WasteReason.StaffMeal]);
    await record.submit.click();

    await expect(page).toHaveURL(new RegExp(`${ROUTES.wasteRecord}$`));
    await expect.poll(() => api.items.balance(item.id)).toBe(36);
    const entries = await api.waste.list(`itemId=${item.id}`);
    expect(entries.items).toHaveLength(1);
  });

  test('an item with nothing left is not offered', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 0 });
    const page = await signIn('cashier', { landing: true });
    const record = new RecordWastePage(page);

    await record.openPicker();
    await record.search.fill(item.name);
    await expect(record.empty).toBeVisible();
    await expect(record.item(item.name)).toHaveCount(0);
  });

  test('going back with something typed asks before discarding', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const page = await signIn('cashier', { landing: true });
    const record = new RecordWastePage(page);

    await record.openItem(item.id);
    await record.quantity.fill('3');
    await page.getByRole('link', { name: 'Go back' }).click();
    await expect(record.discardDialog).toBeVisible();

    await page.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(record.discardDialog).toBeHidden();
    await expect(record.quantity).toHaveValue('3');

    await page.getByRole('link', { name: 'Go back' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.wasteRecord}$`));
    expect(await api.items.balance(item.id)).toBe(40);
  });

  test('leaving an untouched form does not ask', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const page = await signIn('cashier', { landing: true });
    const record = new RecordWastePage(page);

    await record.openItem(item.id);
    await page.getByRole('link', { name: 'Go back' }).click();

    await expect(record.discardDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${ROUTES.wasteRecord}$`));
  });

  test('both pages fit the screen in the cafe style at every width', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const page = await signIn('cashier', { landing: true });
    await useStyle(page, 'cafe');
    await page.reload();
    const record = new RecordWastePage(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await record.openPicker();
      await expect(record.item(item.name)).toBeVisible();
      expect(overflowProblem(await measureOverflow(page)), `${viewport.name}: picker`).toBeNull();

      await record.openItem(item.id);
      await expect(record.submit).toBeInViewport();
      expect(overflowProblem(await measureOverflow(page)), `${viewport.name}: form`).toBeNull();
      await page.screenshot({ path: `test-results/waste-record/cafe-${viewport.width}.png` });
    }
  });

  test('a viewer cannot open the page and the API refuses', async ({ api, signIn }) => {
    const item = await api.items.create();
    const page = await signIn('viewer', { landing: true });

    await page.goto(ROUTES.wasteRecord);
    await expect(page).not.toHaveURL(new RegExp(`${ROUTES.wasteRecord}$`));
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
