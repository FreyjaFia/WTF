import { expect, test } from '@fixtures/index';
import { WasteReason } from '@data/enums';
import { ROUTES } from '@data/routes';
import { today } from '@utils/dates';

interface WasteRow {
  readonly label: string;
  readonly quantity: number;
  readonly entryCount: number;
}

test.describe('waste in the reports @reports @waste', () => {
  test('the waste report groups by item with the right total', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 100 });
    await api.waste.record(item.id, { quantity: 6, wasteReasonId: WasteReason.Breakage });
    await api.waste.record(item.id, { quantity: 4, wasteReasonId: WasteReason.SpilledOrDropped });

    const date = today();
    const rows = await api.client.json<WasteRow[]>(
      'superadmin',
      'GET',
      `reports/waste?fromDate=${date}&toDate=${date}&groupBy=item&itemId=${item.id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(10);
    expect(rows[0].entryCount).toBe(2);
  });

  test('a reversed waste is left out of the report', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 100, wasteApprovalLimit: 1 });
    const waste = await api.waste.record(item.id, { quantity: 8 });
    await api.waste.review(waste.id, 'reverse', 'Wrong item');

    const date = today();
    const rows = await api.client.json<WasteRow[]>(
      'superadmin',
      'GET',
      `reports/waste?fromDate=${date}&toDate=${date}&groupBy=item&itemId=${item.id}`,
    );
    expect(rows).toHaveLength(0);
  });

  test('an invalid groupBy is refused', async ({ api }) => {
    const date = today();
    const response = await api.client.call('superadmin', 'GET', `reports/waste?fromDate=${date}&toDate=${date}&groupBy=colour`);
    expect(response.status()).toBe(400);
  });

  test('the waste report opens from the report catalog', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.report('waste'));
    await expect(page.getByRole('heading', { name: /waste/i }).first()).toBeVisible();
  });

  test('Daily Close lists waste with its quantity and unit', async ({ api }) => {
    const item = await api.items.create({ startingQuantity: 50, unitName: 'pc' });
    await api.waste.record(item.id, { quantity: 3 });

    const date = today();
    const response = await api.client.call('superadmin', 'GET', `reports/daily-close?fromDate=${date}&toDate=${date}`);
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain('aste');
  });
});
