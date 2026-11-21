import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { KitchenPage } from '@pages/kitchen.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/kitchen-branches';

function branchCode(): string {
  return unique('K').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-5);
}

interface KitchenCard {
  readonly id: string;
  readonly orderNumber: number;
  readonly branchCode: string | null;
}

test.describe('the kitchen board by branch @kitchen @branches', () => {
  test('each branch board lists only its own orders, and All branches lists both with the branch code', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const drink = await api.products.create({ price: 120 });
      const body = api.orders.body({ items: [{ productId: drink.id, quantity: 1, addOns: [] }] });
      const place = async (where: string): Promise<string> => {
        const response = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': where } });
        expect(response.status(), await response.text()).toBe(201);
        return ((await response.json()) as { id: string }).id;
      };
      const inMain = await place(main.id);
      const inBranch = await place(branch.id);

      const board = async (where: string): Promise<readonly KitchenCard[]> => {
        const response = await api.client.call('owner', 'GET', 'kitchen/orders', { headers: { 'X-Branch-Id': where } });
        expect(response.status(), await response.text()).toBe(200);
        return ((await response.json()) as { orders: KitchenCard[] }).orders;
      };

      const mainIds = (await board(main.id)).map((o) => o.id);
      expect(mainIds).toContain(inMain);
      expect(mainIds).not.toContain(inBranch);

      const branchCards = await board(branch.id);
      expect(branchCards.map((o) => o.id)).toEqual([inBranch]);
      expect(branchCards[0].branchCode).toBe(branch.code);

      const everywhere = (await board('all')).map((o) => o.id);
      expect(everywhere).toEqual(expect.arrayContaining([inMain, inBranch]));
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`the board names its branch and shows the branch order label when All branches is picked at ${viewport.name}`, async ({ signIn, api }) => {
      const branch = await api.branches.create(branchCode(), unique('Harbor'));
      mkdirSync(SHOTS, { recursive: true });
      try {
        const main = await api.branches.main();
        const drink = await api.products.create({ name: unique('Branch Latte'), price: 120 });
        const body = api.orders.body({ items: [{ productId: drink.id, quantity: 2, addOns: [] }] });
        const response = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': branch.id } });
        const order = (await response.json()) as { orderNumber: number };

        const page = await signIn('owner');
        const watcher = watch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), 'all');
        const kitchen = new KitchenPage(page);
        await kitchen.open();

        await expect(page.getByTestId('kitchen-branch-label')).toContainText('All branches');
        const label = `${branch.code}-${String(order.orderNumber).padStart(4, '0')}`;
        await expect(page.getByText(label).first()).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/kitchen-all-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: kitchen overflow`).toBeNull();

        await page.evaluate((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);
        await page.reload();
        await kitchen.board.waitFor();
        await expect(page.getByTestId('kitchen-branch-label')).toContainText(main.name);
        await expect(page.getByText(label)).toHaveCount(0);
        await page.screenshot({ path: `${SHOTS}/kitchen-main-${viewport.width}.png` });

        expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
        expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
      } finally {
        await api.branches.closeQuietly(branch.id);
      }
    });
  }
});
