import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/branch-levels-cost';

function branchCode(): string {
  return unique('L').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-5);
}

interface BranchStock {
  readonly branchId: string;
  readonly status: string;
  readonly warningQuantity: number | null;
  readonly criticalQuantity: number | null;
  readonly parLevel: number | null;
  readonly costPrice: number | null;
}

test.describe('stock levels and cost by branch @inventory @branches', () => {
  test('a branch level changes the status of that branch only, and clearing it goes back to the shop level', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const item = await api.items.create({ startingQuantity: 80, warningQuantity: 50, criticalQuantity: 10 });
      const everywhere = { 'X-Branch-Id': 'all' };

      const save = await api.client.call('owner', 'PUT', `items/${item.id}/branch-settings`, {
        body: [{ branchId: main.id, warningQuantity: 100, criticalQuantity: 20, parLevel: 200, costPrice: null }],
      });
      expect(save.status(), await save.text()).toBe(200);

      const read = async (): Promise<readonly BranchStock[]> => {
        const detail = (await (await api.client.call('owner', 'GET', `items/${item.id}`, { headers: everywhere })).json()) as { branchStocks: BranchStock[] };
        return detail.branchStocks;
      };

      let rows = await read();
      expect(rows.find((r) => r.branchId === main.id)).toMatchObject({ status: 'warning', warningQuantity: 100, criticalQuantity: 20, parLevel: 200 });
      expect(rows.find((r) => r.branchId === branch.id)).toMatchObject({ warningQuantity: null, criticalQuantity: null, parLevel: null });

      const clear = await api.client.call('owner', 'PUT', `items/${item.id}/branch-settings`, {
        body: [{ branchId: main.id, warningQuantity: null, criticalQuantity: null, parLevel: null, costPrice: null }],
      });
      expect(clear.status(), await clear.text()).toBe(200);
      rows = await read();
      expect(rows.find((r) => r.branchId === main.id)).toMatchObject({ status: 'ok', warningQuantity: null });
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('a sale is costed at the cost of the branch it was made in', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const product = await api.products.create({ price: 100 });
      const item = await api.items.create({ startingQuantity: 100, costPrice: 2, allowNegativeStock: true });
      await api.items.linkProducts(item.id, [{ productId: product.id, quantityPerSale: 1 }]);

      const set = await api.client.call('owner', 'PUT', `items/${item.id}/branch-settings`, {
        body: [{ branchId: branch.id, warningQuantity: null, criticalQuantity: null, parLevel: null, costPrice: 3.5 }],
      });
      expect(set.status(), await set.text()).toBe(200);

      const body = api.orders.body({ items: [{ productId: product.id, quantity: 1, addOns: [] }] });
      for (const where of [main.id, branch.id]) {
        const sold = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': where } });
        expect(sold.status(), await sold.text()).toBe(201);
      }

      const movements = (await (await api.client.call('owner', 'GET', `items/${item.id}/movements?page=1&pageSize=100`, { headers: { 'X-Branch-Id': 'all' } })).json()) as {
        items: { movementType: string; unitCost: number; branchId: string }[];
      };
      const sales = movements.items.filter((m) => m.movementType === 'Sale');
      expect(sales.find((m) => m.branchId === main.id)?.unitCost).toBe(2);
      expect(sales.find((m) => m.branchId === branch.id)?.unitCost).toBe(3.5);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('branch settings are checked, and only people who may edit items can change them', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const item = await api.items.create({});
      const put = (role: 'owner' | 'cashier' | 'viewer', row: Record<string, unknown>) =>
        api.client.call(role, 'PUT', `items/${item.id}/branch-settings`, { body: [{ branchId: branch.id, warningQuantity: null, criticalQuantity: null, parLevel: null, costPrice: null, ...row }] });

      expect((await put('owner', { warningQuantity: -1 })).status()).toBe(400);
      expect((await put('owner', { costPrice: -0.5 })).status()).toBe(400);
      expect((await put('owner', { warningQuantity: 5, criticalQuantity: 9 })).status()).toBe(400);
      expect((await put('cashier', { warningQuantity: 5 })).status()).toBe(403);
      expect((await put('viewer', { warningQuantity: 5 })).status()).toBe(403);
      expect((await put('owner', { warningQuantity: 9, criticalQuantity: 5 })).status()).toBe(200);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`the owner sets the levels and cost of a branch on the item at ${viewport.name}`, async ({ signIn, api }) => {
      const branch = await api.branches.create(branchCode(), unique('Harbor'));
      mkdirSync(SHOTS, { recursive: true });
      try {
        const main = await api.branches.main();
        const item = await api.items.create({ name: unique('Oat Milk'), startingQuantity: 800, costPrice: 0.09, warningQuantity: 500, criticalQuantity: 200 });

        const page = await signIn('owner');
        const watcher = watch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);

        await go(page, `/inventory/items/details/${item.id}`);
        const card = page.getByTestId('branch-settings');
        await expect(card).toBeVisible();
        await expect(page.getByTestId(`branch-warning-${branch.code}`)).toHaveAttribute('placeholder', '500');
        await expect(page.getByTestId('branch-settings-save')).toBeDisabled();
        // The item reloads after a save and the card can be replaced mid-action, so try again until it settles.
        await expect(async () => {
          await card.scrollIntoViewIfNeeded();
          await card.screenshot({ path: `${SHOTS}/item-before-${viewport.width}.png` });
        }).toPass();

        await page.getByTestId(`branch-warning-${branch.code}`).fill('1000');
        await page.getByTestId(`branch-critical-${branch.code}`).fill('400');
        await page.getByTestId(`branch-cost-${branch.code}`).fill('0.11');
        await expect(page.getByTestId('branch-settings-save')).toBeEnabled();
        await page.getByTestId('branch-settings-save').click();
        await expect(page.getByTestId('branch-settings-save')).toHaveText('Save');
        await expect(page.getByTestId('branch-settings-save')).toBeDisabled();
        await expect(page.getByTestId(`branch-warning-${branch.code}`)).toHaveValue('1000');
        // The item reloads after a save and the card can be replaced mid-action, so try again until it settles.
        await expect(async () => {
          await card.scrollIntoViewIfNeeded();
          await card.screenshot({ path: `${SHOTS}/item-saved-${viewport.width}.png` });
        }).toPass();
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: item overflow`).toBeNull();

        const saved = (await (await api.client.call('owner', 'GET', `items/${item.id}`, { headers: { 'X-Branch-Id': 'all' } })).json()) as { branchStocks: BranchStock[] };
        expect(saved.branchStocks.find((s) => s.branchId === branch.id)).toMatchObject({ warningQuantity: 1000, criticalQuantity: 400, costPrice: 0.11 });

        expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
        expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
      } finally {
        await api.branches.closeQuietly(branch.id);
      }
    });
  }
});
