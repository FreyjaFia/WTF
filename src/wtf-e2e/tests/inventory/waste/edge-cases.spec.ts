import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { WASTE_REASON_NAMES, WasteReason, WasteSource } from '@data/enums';
import { ItemDetailsPage } from '@pages/item-details.page';
import { RecordWasteDialog } from '@pages/record-waste-dialog.page';
import { WasteListPage } from '@pages/waste-list.page';
import { unique } from '@utils/unique';

const LONG_NAME_PREFIX = 'Very Long Waste Name That Keeps Wrapping On Phones And Tablets Without Overflow';

test.describe('waste quantities at the edges @waste', () => {
  test('waste exactly at the approval limit is just recorded, a hair above goes to review', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });

    const atLimit = await api.waste.record(item.id, { quantity: 10 });
    const aboveLimit = await api.waste.record(item.id, { quantity: 10.001 });

    const entries = await api.waste.list(`itemId=${item.id}`);
    const statusOf = (id: string): string | undefined => entries.items.find((entry) => entry.id === id)?.status;
    expect(statusOf(atLimit.id)).toBe('Recorded');
    expect(statusOf(aboveLimit.id)).toBe('PendingReview');
    expect(await api.items.balance(item.id)).toBeCloseTo(79.999, 3);
  });

  for (const quantity of [0, -5, 1_000_000]) {
    test(`a quantity of ${quantity} is refused and nothing changes`, async ({ api }) => {
      const item = await api.items.create({ startingQuantity: 20 });

      const response = await api.waste.recordRaw(item.id, { quantity });

      expect(response.status()).toBe(400);
      expect(await api.items.balance(item.id)).toBe(20);
      expect((await api.waste.list(`itemId=${item.id}`)).totalCount).toBe(0);
    });
  }

  test('the smallest allowed quantity, 0.001, is recorded', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 5 });

    await api.waste.record(item.id, { quantity: 0.001 });

    expect(await api.items.balance(item.id)).toBeCloseTo(4.999, 3);
  });

  test('the dialog asks for an amount before it sends anything', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 20 });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(0, WASTE_REASON_NAMES[WasteReason.Breakage]);
    await dialog.submit();

    await expect(dialog.error).toContainText('Enter how much was wasted');
    expect(await api.items.balance(item.id)).toBe(20);
  });
});

test.describe('the same waste is never recorded twice @waste', () => {
  test('a retried request with the same id returns the first entry', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 50 });
    const body = {
      quantity: 8,
      wasteReasonId: WasteReason.SpilledOrDropped,
      notes: null,
      source: WasteSource.Inventory,
      clientRequestId: crypto.randomUUID(),
    };

    const first = await api.client.call('superadmin', 'POST', `items/${item.id}/stock/waste`, { body });
    const second = await api.client.call('superadmin', 'POST', `items/${item.id}/stock/waste`, { body });

    expect(first.ok()).toBeTruthy();
    expect(second.ok()).toBeTruthy();
    expect((await first.json()).id).toBe((await second.json()).id);
    expect(await api.items.balance(item.id)).toBe(42);
    expect((await api.waste.list(`itemId=${item.id}`)).totalCount).toBe(1);
  });

  test('a request id already used for another item is refused', async ({ api }) => {
    const first = await api.items.create({ startingQuantity: 50 });
    const second = await api.items.create({ startingQuantity: 50 });
    const clientRequestId = crypto.randomUUID();
    const body = { quantity: 3, wasteReasonId: WasteReason.Breakage, notes: null, source: WasteSource.Inventory, clientRequestId };

    expect((await api.client.call('superadmin', 'POST', `items/${first.id}/stock/waste`, { body })).ok()).toBeTruthy();
    const reused = await api.client.call('superadmin', 'POST', `items/${second.id}/stock/waste`, { body });

    expect(reused.status()).toBe(400);
    expect(await api.items.balance(second.id)).toBe(50);
  });

  test('double clicking Record Waste records it once', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100 });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(30, WASTE_REASON_NAMES[WasteReason.SpilledOrDropped]);
    await dialog.confirm.dblclick();

    await expect(dialog.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(70);
    expect((await api.waste.list(`itemId=${item.id}`)).totalCount).toBe(1);
  });
});

test.describe('review rules for waste @waste', () => {
  async function pending(api: Api) {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });
    const waste = await api.waste.record(item.id, { quantity: 30 });
    return { item, waste };
  }

  test('an entry that was disputed can no longer be confirmed, and the other way round', async ({ api }) => {
    const disputed = await pending(api);
    const confirmed = await pending(api);

    expect((await api.waste.review(disputed.waste.id, 'dispute', 'Looks too high')).ok()).toBeTruthy();
    expect((await api.waste.review(disputed.waste.id, 'confirm', 'Changed my mind')).status()).toBe(400);

    expect((await api.waste.review(confirmed.waste.id, 'confirm', 'Seen it')).ok()).toBeTruthy();
    expect((await api.waste.review(confirmed.waste.id, 'dispute', 'Too late')).status()).toBe(400);

    expect(await api.items.balance(disputed.item.id)).toBe(70);
    expect(await api.items.balance(confirmed.item.id)).toBe(70);
  });

  test('a disputed entry can still be reversed, and the stock comes back', async ({ api }) => {
    const { item, waste } = await pending(api);

    await api.waste.review(waste.id, 'dispute', 'Looks too high');
    const reversed = await api.waste.review(waste.id, 'reverse', 'Entered twice');

    expect(reversed.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(100);
  });

  test('a dispute or a reversal without a note is refused', async ({ api }) => {
    const { item, waste } = await pending(api);

    expect((await api.waste.review(waste.id, 'dispute', '')).status()).toBe(400);
    expect((await api.waste.review(waste.id, 'reverse', '   ')).status()).toBe(400);
    expect((await api.waste.review(waste.id, 'dispute', 'x'.repeat(501))).status()).toBe(400);

    expect(await api.items.balance(item.id)).toBe(70);
    const entries = await api.waste.list(`itemId=${item.id}`);
    expect(entries.items[0].status).toBe('PendingReview');
  });

  test('waste on a deleted item cannot be reversed until the item is restored', async ({ api }) => {
    const { item, waste } = await pending(api);
    await api.items.remove(item.id);

    const refused = await api.waste.review(waste.id, 'reverse', 'Entered by mistake');
    expect(refused.status()).toBe(400);

    await api.items.restore(item.id);
    const allowed = await api.waste.review(waste.id, 'reverse', 'Entered by mistake');
    expect(allowed.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(100);
  });

  test('a recorded entry that never needed review can still be reversed', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 40 });
    const waste = await api.waste.record(item.id, { quantity: 5 });
    expect(waste.status).toBe('Recorded');

    const reversed = await api.waste.review(waste.id, 'reverse', 'Wrong item');

    expect(reversed.ok()).toBeTruthy();
    expect(await api.items.balance(item.id)).toBe(40);
  });
});

test.describe('waste screens at small widths and long names @waste @layout', () => {
  const longName = (): string => `${LONG_NAME_PREFIX} ${unique('x')}`.slice(0, 95);

  test('the waste list wraps a long item name at phone width without sideways scrolling', async ({ api, signIn }) => {
    const name = longName();
    const item = await api.items.create({ name, startingQuantity: 50 });
    const waste = await api.waste.record(item.id, { quantity: 4 });
    const page = await signIn('superadmin');
    const list = new WasteListPage(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await list.open();
    await list.search.fill(name.slice(0, 40));

    await expect(list.entry(waste.id)).toBeVisible();
    const box = await list.entry(waste.id).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('an item name with no spaces still stays inside the screen', async ({ api, signIn }) => {
    const name = `W${'ideunbrokenname'.repeat(5)}${Date.now().toString(36)}`.slice(0, 95);
    const item = await api.items.create({ name, startingQuantity: 50 });
    const waste = await api.waste.record(item.id, { quantity: 4 });
    const page = await signIn('superadmin');
    const list = new WasteListPage(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await list.open();
    await list.search.fill(name.slice(0, 30));

    await expect(list.entry(waste.id)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('the item details title stays readable at tablet width', async ({ api, signIn }) => {
    const item = await api.items.create({ name: longName(), startingQuantity: 50 });
    const page = await signIn('superadmin');
    await page.setViewportSize({ width: 740, height: 840 });
    const details = new ItemDetailsPage(page);

    await details.open(item.id);

    const title = page.locator('app-page-title h1');
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeLessThan(120);
  });

  test('opening an item from the waste list and pressing back returns to the waste list', async ({ api, signIn }) => {
    const name = longName();
    const item = await api.items.create({ name, startingQuantity: 50 });
    const waste = await api.waste.record(item.id, { quantity: 4 });
    const page = await signIn('superadmin');
    const list = new WasteListPage(page);

    await list.open();
    await list.search.fill(name.slice(0, 40));
    await list.entry(waste.id).getByRole('button', { name: name.slice(0, 20) }).click();
    await expect(page).toHaveURL(new RegExp(`/inventory/items/details/${item.id}`));

    await page.getByRole('link', { name: 'Go back' }).click();

    await expect(page).toHaveURL(/\/inventory\/waste/);
  });

  test('the review chip is shown to an admin and hidden from a stock manager', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });
    await api.waste.record(item.id, { quantity: 30 });

    const adminPage = await signIn('admin');
    const adminList = new WasteListPage(adminPage);
    await adminList.open();
    await expect(adminList.pendingTile).toContainText('need review');

    const stockPage = await signIn('stockmgr');
    const stockList = new WasteListPage(stockPage);
    await stockList.open();
    await expect(stockList.pendingTile).toHaveCount(0);
  });
});
