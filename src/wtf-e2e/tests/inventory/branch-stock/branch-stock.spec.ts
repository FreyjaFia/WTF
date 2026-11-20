import { StockExtraApi } from '@api/stock-extra';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/branch-stock';

function branchCode(): string {
  return unique('S').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-5);
}

test.describe('stock by branch @inventory @branches', () => {
  test('a transfer moves stock between branches, and a limited person cannot read or change another branch', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const created = await new StockExtraApi(api.client).createItemRaw({ startingQuantity: 40, allowNegativeStock: false });
      expect(created.ok(), await created.text()).toBeTruthy();
      const item = (await created.json()) as { id: string };
      const inMain = { 'X-Branch-Id': main.id };
      const inNew = { 'X-Branch-Id': branch.id };

      const send = await api.client.call('owner', 'POST', 'stock-transfers', {
        body: { toBranchId: branch.id, notes: 'Weekend rush', lines: [{ itemId: item.id, quantity: 15 }] },
        headers: inMain,
      });
      expect(send.status(), await send.text()).toBe(201);

      const fromMain = (await (await api.client.call('owner', 'GET', `items/${item.id}`, { headers: inMain })).json()) as { currentQuantity: number };
      const fromNew = (await (await api.client.call('owner', 'GET', `items/${item.id}`, { headers: inNew })).json()) as { currentQuantity: number };
      expect(fromMain.currentQuantity).toBe(25);
      expect(fromNew.currentQuantity).toBe(15);

      const everywhere = (await (await api.client.call('owner', 'GET', `items/${item.id}`, { headers: { 'X-Branch-Id': 'all' } })).json()) as {
        currentQuantity: number;
        branchStocks: { branchId: string; quantity: number }[];
      };
      expect(everywhere.currentQuantity).toBe(40);
      expect(everywhere.branchStocks.find((s) => s.branchId === branch.id)?.quantity).toBe(15);

      const tooMuch = await api.client.call('owner', 'POST', 'stock-transfers', {
        body: { toBranchId: branch.id, notes: null, lines: [{ itemId: item.id, quantity: 500 }] },
        headers: inMain,
      });
      expect(tooMuch.ok()).toBe(false);

      const cashierReads = await api.client.call('cashier', 'GET', `items/${item.id}`, { headers: inNew });
      expect(cashierReads.status()).toBe(403);
      const cashierMoves = await api.client.call('cashier', 'POST', 'stock-transfers', {
        body: { toBranchId: main.id, notes: null, lines: [{ itemId: item.id, quantity: 1 }] },
        headers: inNew,
      });
      expect(cashierMoves.status()).toBe(403);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`the owner moves stock and sees each branch's level at ${viewport.name}`, async ({ signIn, api }) => {
      const branch = await api.branches.create(branchCode(), unique('Harbor'));
      mkdirSync(SHOTS, { recursive: true });
      try {
        const created = await new StockExtraApi(api.client).createItemRaw({ name: unique('Oat Milk'), startingQuantity: 60, allowNegativeStock: false });
        const item = (await created.json()) as { id: string; name: string };
        const main = await api.branches.main();

        const page = await signIn('owner');
        const watcher = watch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);

        await go(page, '/inventory/transfers');
        await expect(page.getByTestId('open-transfer')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/transfers-before-${viewport.width}.png` });

        await page.getByTestId('open-transfer').click();
        await page.getByTestId('transfer-to').selectOption(branch.id);
        await page.getByTestId('transfer-line').first().locator('select').selectOption(item.id);
        await page.getByTestId('transfer-line').first().locator('input[type="number"]').fill('20');
        await page.screenshot({ path: `${SHOTS}/transfer-form-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: form overflow`).toBeNull();

        await page.getByTestId('submit-transfer').click();
        const row = page.getByTestId('transfer-row').filter({ hasText: branch.name });
        await expect(row).toBeVisible();
        await expect(row).toContainText(branch.name);
        await page.screenshot({ path: `${SHOTS}/transfers-list-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: list overflow`).toBeNull();

        await page.addInitScript(() => localStorage.setItem('wtf_active_branch', 'all'));
        await page.evaluate(() => localStorage.setItem('wtf_active_branch', 'all'));
        await go(page, `/inventory/items/details/${item.id}`);
        await expect(page.getByTestId('branch-stocks')).toBeVisible();
        await expect(page.getByTestId('branch-stock-row').filter({ hasText: main.name })).toContainText('40');
        await expect(page.getByTestId('branch-stock-row').filter({ hasText: branch.name })).toContainText('20');
        await page.screenshot({ path: `${SHOTS}/item-by-branch-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: item overflow`).toBeNull();

        expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
        expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
      } finally {
        await api.branches.closeQuietly(branch.id);
      }
    });
  }
});
