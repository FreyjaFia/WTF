import { expect, test } from '@fixtures/index';
import { WASTE_REASON_NAME_MAX } from '@data/enums';
import { ItemDetailsPage } from '@pages/item-details.page';
import { RecordWasteDialog } from '@pages/record-waste-dialog.page';
import { WasteReasonsPage } from '@pages/waste-reasons.page';
import { unique } from '@utils/unique';

test.describe('managing waste reasons @waste', () => {
  test('an admin adds a reason and staff can pick it', async ({ api, signIn }) => {
    const name = unique('Test reason');
    const page = await signIn('admin');
    const reasons = new WasteReasonsPage(page);

    await reasons.open();
    await reasons.addReason(name);
    await expect(reasons.row(name)).toBeVisible();

    const item = await api.items.create();
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);
    await details.open(item.id);
    await details.recordWaste.click();
    await expect(dialog.reason.locator('option', { hasText: name })).toHaveCount(1);
  });

  test('a turned-off reason is not offered and can be restored', async ({ api, signIn }) => {
    const name = unique('Old reason');
    await api.waste.createReason(name);
    const page = await signIn('admin');
    const reasons = new WasteReasonsPage(page);

    await reasons.open();
    await reasons.row(name).getByRole('button', { name: 'Turn Off' }).click();
    await reasons.confirmDialog('Turn Off');
    await expect(reasons.row(name)).toContainText('Inactive');

    const item = await api.items.create();
    const details = new ItemDetailsPage(page);
    const dialog = new RecordWasteDialog(page);
    await details.open(item.id);
    await details.recordWaste.click();
    await expect(dialog.reason.locator('option', { hasText: name })).toHaveCount(0);

    await reasons.open();
    await reasons.row(name).getByRole('button', { name: 'Restore' }).click();
    await reasons.confirmDialog('Restore');
    await expect(reasons.row(name)).toContainText('Active');
  });

  test('the built-in Other reason cannot be turned off', async ({ signIn }) => {
    const page = await signIn('admin');
    const reasons = new WasteReasonsPage(page);

    await reasons.open();
    const other = reasons.row('Other').filter({ hasText: 'Built-in' });
    await expect(other).toBeVisible();
    await expect(other.getByRole('button', { name: 'Turn Off' })).toHaveCount(0);
  });

  test('a duplicate or too long name is refused', async ({ api, signIn }) => {
    const name = unique('Dup reason');
    await api.waste.createReason(name);
    const page = await signIn('admin');
    const reasons = new WasteReasonsPage(page);

    await reasons.open();
    await reasons.addReason(name);
    await expect(reasons.formError).toBeVisible();

    const tooLong = await api.client.call('admin', 'POST', 'waste-reasons', {
      body: { name: 'x'.repeat(WASTE_REASON_NAME_MAX + 1), requiresNote: false, sortOrder: 1 },
    });
    expect(tooLong.status()).toBe(400);
  });

  test('a stock manager cannot change reasons', async ({ api }) => {
    const response = await api.client.call('stockmgr', 'POST', 'waste-reasons', {
      body: { name: unique('Nope'), requiresNote: false, sortOrder: 1 },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('who can read the waste reasons @waste', () => {
  test('a viewer can read the reasons list but not change it', async ({ api }) => {
    const read = await api.client.call('viewer', 'GET', 'waste-reasons');
    expect(read.ok()).toBeTruthy();
    const write = await api.client.call('viewer', 'POST', 'waste-reasons', {
      body: { name: unique('Nope'), requiresNote: false, sortOrder: 1 },
    });
    expect(write.status()).toBe(403);
  });
});
