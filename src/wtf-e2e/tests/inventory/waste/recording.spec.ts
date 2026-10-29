import { expect, test } from '@fixtures/index';
import { WASTE_REASON_NAMES, WasteReason } from '@data/enums';
import { ItemDetailsPage } from '@pages/item-details.page';
import { RecordWasteDialog } from '@pages/record-waste-dialog.page';

test.describe('recording waste from the item page @waste', () => {
  test('a recorded waste lowers the balance and shows in the stock history', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100 });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(30, WASTE_REASON_NAMES[WasteReason.SpilledOrDropped]);
    await expect(dialog.balanceHint).toContainText('after 70');
    await dialog.submit();

    await expect(dialog.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(70);
    await expect(details.movements.filter({ hasText: 'Waste' }).first()).toBeVisible();
  });

  test('the reason Other asks for a note', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 50 });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(5, WASTE_REASON_NAMES[WasteReason.Other]);
    await dialog.submit();
    await expect(dialog.root).toBeVisible();
    expect(await api.items.balance(item.id)).toBe(50);

    await dialog.notes.fill('Dropped the whole tray');
    await dialog.submit();
    await expect(dialog.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(45);
  });

  test('an item that blocks sales cannot be wasted below zero', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10, allowNegativeStock: false });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(11, WASTE_REASON_NAMES[WasteReason.Breakage]);
    await expect(dialog.blockedNotice).toBeVisible();
    await dialog.submit();
    await expect(dialog.root).toBeVisible();
    expect(await api.items.balance(item.id)).toBe(10);
  });

  test('a warn-only item goes below zero with a warning', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 10, allowNegativeStock: true });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(12, WASTE_REASON_NAMES[WasteReason.ExpiredOrSpoiled]);
    await expect(dialog.belowZeroNotice).toBeVisible();
    await dialog.submit();
    await expect(dialog.root).toBeHidden();
    await expect.poll(() => api.items.balance(item.id)).toBe(-2);
  });

  test('waste above the approval limit is taken at once and sent for review', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);

    await details.open(item.id);
    await details.recordWaste.click();
    await dialog.fill(25, WASTE_REASON_NAMES[WasteReason.QualityFailed]);
    await expect(dialog.reviewNotice).toBeVisible();
    await dialog.submit();
    await expect(dialog.root).toBeHidden();

    await expect.poll(() => api.items.balance(item.id)).toBe(75);
    const entries = await api.waste.list(`itemId=${item.id}`);
    expect(entries.items.map((entry) => entry.status)).toEqual(['PendingReview']);
  });

  test('an inactive item offers no Record Waste button', async ({ api, signIn }) => {
    const item = await api.items.create();
    await api.items.remove(item.id);
    const page = await signIn('superadmin');
    const details = new ItemDetailsPage(page);

    await details.open(item.id);
    await expect(details.recordWaste).toHaveCount(0);
  });

  test('a viewer cannot record waste', async ({ api, signIn }) => {
    const item = await api.items.create();
    const page = await signIn('viewer');
    const details = new ItemDetailsPage(page);

    await details.open(item.id);
    await expect(details.recordWaste).toHaveCount(0);
    const response = await api.waste.recordRaw(item.id, { quantity: 1 }, 'viewer');
    expect(response.status()).toBe(403);
  });
});
