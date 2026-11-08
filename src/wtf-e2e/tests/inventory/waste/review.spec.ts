import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { WasteListPage } from '@pages/waste-list.page';

async function pendingWaste(api: Api, quantity: number = 30) {
  const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });
  const waste = await api.waste.record(item.id, { quantity });
  return { item, waste };
}

test.describe('reviewing large waste @waste', () => {
  test('an admin confirms a pending waste and the stock stays down', async ({ api, signIn }) => {
    const { item, waste } = await pendingWaste(api);
    const page = await signIn('admin');
    const list = new WasteListPage(page);

    await list.open();
    await list.review(waste.id, 'Confirm', 'Seen the bin');
    await expect(list.entry(waste.id)).toContainText('Confirmed');
    expect(await api.items.balance(item.id)).toBe(70);
  });

  test('a disputed waste keeps the stock down and shows the note', async ({ api, signIn }) => {
    const { item, waste } = await pendingWaste(api);
    const page = await signIn('admin');
    const list = new WasteListPage(page);

    await list.open();
    await list.review(waste.id, 'Dispute', 'Too much for one spill');
    await expect(list.entry(waste.id)).toContainText('Disputed');
    await expect(list.entry(waste.id)).toContainText('Too much for one spill');
    expect(await api.items.balance(item.id)).toBe(70);
  });

  test('reversing puts the quantity back once and only once', async ({ api, signIn }) => {
    const { item, waste } = await pendingWaste(api);
    const page = await signIn('admin');
    const list = new WasteListPage(page);

    await list.open();
    await list.review(waste.id, 'Reverse', 'Entered by mistake');
    await expect(list.entry(waste.id)).toContainText('Reversed');
    expect(await api.items.balance(item.id)).toBe(100);
    await expect(list.entry(waste.id).getByRole('button', { name: 'Reverse', exact: true })).toHaveCount(0);

    const again = await api.waste.review(waste.id, 'reverse', 'Second try');
    expect(again.ok()).toBeFalsy();
    expect(await api.items.balance(item.id)).toBe(100);
  });

  test('the needs review tile counts and filters pending waste', async ({ api, signIn }) => {
    const { waste } = await pendingWaste(api);
    const page = await signIn('admin');
    const list = new WasteListPage(page);

    await list.open();
    await expect(list.pendingTile).not.toContainText(/^\s*0\s*$/);
    await list.pendingTile.click();
    await expect(list.entry(waste.id)).toBeVisible();
    await expect(list.pendingTile).toHaveAttribute('aria-pressed', 'true');
  });

  test('a stock manager can see waste but cannot review it', async ({ api, signIn }) => {
    const { waste } = await pendingWaste(api);
    const page = await signIn('stockmgr');
    const list = new WasteListPage(page);

    await list.open();
    await expect(list.pendingTile).toHaveCount(0);
    const response = await api.waste.review(waste.id, 'confirm', null, 'stockmgr');
    expect(response.status()).toBe(403);
  });
});

test.describe('filtering the waste list @waste', () => {
  test('the Filters drawer narrows the list by status and reason and shows a count', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 10 });
    const small = await api.waste.record(item.id, { quantity: 2, wasteReasonId: 7 });
    const large = await api.waste.record(item.id, { quantity: 30, wasteReasonId: 2 });
    const page = await signIn('admin');
    const list = new WasteListPage(page);

    await list.open();
    await expect(list.entry(small.id)).toBeVisible();
    await expect(list.entry(large.id)).toBeVisible();

    await list.openFilters();
    await list.chooseStatus('Needs review');
    await list.closeFilters();
    await expect(list.entry(large.id)).toBeVisible();
    await expect(list.entry(small.id)).toHaveCount(0);
    await expect(list.filtersButton).toContainText('1');

    await list.openFilters();
    await list.chooseReason('Breakage');
    await list.closeFilters();
    await expect(list.empty).toBeVisible();
    await expect(list.filtersButton).toContainText('2');
  });

  test('the column headers sort the waste list on a wide screen and are hidden on a phone', async ({ api, signIn }) => {
    const small = await api.items.create({ startingQuantity: 100 });
    const large = await api.items.create({ startingQuantity: 100 });
    const smallWaste = await api.waste.record(small.id, { quantity: 2 });
    const largeWaste = await api.waste.record(large.id, { quantity: 9 });

    const page = await signIn('admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const list = new WasteListPage(page);
    await list.open();
    const columns = page.getByTestId('waste-columns');
    await expect(columns).toBeVisible();
    for (const name of ['Item', 'Recorded', 'Quantity', 'Status']) {
      await expect(columns).toContainText(name);
    }

    const order = async (): Promise<string[]> => {
      const ids = await page.locator('li[data-testid^="waste-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
      return ids.filter((id) => id === `waste-${smallWaste.id}` || id === `waste-${largeWaste.id}`).map((id) => (id === `waste-${smallWaste.id}` ? 'small' : 'large'));
    };
    await page.getByRole('button', { name: 'Sort by Quantity' }).click();
    await expect.poll(order).toEqual(['small', 'large']);
    await page.getByRole('button', { name: 'Sort by Quantity' }).click();
    await expect.poll(order).toEqual(['large', 'small']);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(columns).toBeHidden();
  });
});
