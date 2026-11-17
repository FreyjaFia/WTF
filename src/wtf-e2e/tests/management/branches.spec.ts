import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

function branchCode(): string {
  const stamp = unique('B').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return stamp.slice(-5);
}

test.describe('Branches @management @branches', () => {
  test('a branch keeps its own orders, order numbers and staff access', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const product = await api.products.create();
      const body = api.orders.body({ items: [{ productId: product.id, quantity: 1 }] });
      const asBranch = { 'X-Branch-Id': branch.id };

      const created = await api.client.call('owner', 'POST', 'orders', { body, headers: asBranch });
      expect(created.ok(), await created.text()).toBeTruthy();
      const order = (await created.json()) as { id: string; orderNumber: number; branchCode: string };
      expect(order.orderNumber).toBe(1);
      expect(order.branchCode).toBe(branch.code);

      const same = await api.client.call('owner', 'GET', `orders/${order.id}`, { headers: asBranch });
      expect(same.status()).toBe(200);

      const main = await api.branches.main();
      const other = await api.client.call('owner', 'GET', `orders/${order.id}`, { headers: { 'X-Branch-Id': main.id } });
      expect(other.status()).toBe(404);

      const everywhere = await api.client.call('owner', 'GET', `orders/${order.id}`, { headers: { 'X-Branch-Id': 'all' } });
      expect(everywhere.status()).toBe(200);

      const writeAll = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': 'all' } });
      expect(writeAll.status()).toBe(400);

      const cashierThere = await api.client.call('cashier', 'GET', 'orders', { headers: asBranch });
      expect(cashierThere.status()).toBe(403);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('a branch code cannot be used twice, and the main branch cannot be closed', async ({ api }) => {
    const code = branchCode();
    const branch = await api.branches.create(code);
    try {
      const again = await api.client.call('owner', 'POST', 'branches', {
        body: { name: unique('Copy'), code, address: null, phone: null },
      });
      expect(again.ok()).toBe(false);

      const main = await api.branches.main();
      const closeMain = await api.branches.close(main.id);
      expect(closeMain.ok()).toBe(false);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('a cashier cannot manage branches', async ({ api }) => {
    const response = await api.client.call('cashier', 'POST', 'branches', {
      body: { name: unique('Nope'), code: branchCode(), address: null, phone: null },
    });
    expect(response.status()).toBe(403);
  });

  for (const viewport of VIEWPORTS) {
    test(`the owner adds a branch and closes it again at ${viewport.name}`, async ({ signIn, api }) => {
      const page = await signIn('owner');
      const watcher = watch(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const name = unique('Harbor');
      const code = branchCode();
      await go(page, '/management/branches');
      await expect(page.getByTestId('branch-list')).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: list overflow`).toBeNull();

      await page.getByTestId('add-branch').click();
      await page.locator('#branch-name').fill(name);
      await page.locator('#branch-code').fill(code);
      await page.locator('#branch-address').fill('88 Roxas Boulevard, Pasay City');
      await page.getByRole('button', { name: 'Add Branch' }).last().click();

      const row = page.getByTestId(`branch-row-${code}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(name);
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: added overflow`).toBeNull();

      await page.reload();
      await page.locator('[data-testid="branch-switcher-button"]:visible').click();
      const menu = page.locator('[data-testid="branch-switcher-menu"]:visible');
      await expect(menu).toBeVisible();
      await expect(page.locator(`[data-testid="branch-option-${code}"]:visible`)).toBeVisible();
      const box = await menu.boundingBox();
      expect.soft(box && box.x >= 0 && box.x + box.width <= viewport.width, `${viewport.name}: switcher inside the screen`).toBe(true);
      await page.keyboard.press('Escape');

      await go(page, '/management/branches');
      await page.getByTestId(`branch-row-${code}`).getByRole('button', { name: 'Branch actions' }).click();
      await page.getByTestId(`branch-row-${code}`).getByRole('button', { name: 'Close' }).click();
      await expect(page.getByTestId('close-branch-check')).toContainText('0 open orders');
      await page.getByRole('button', { name: 'Close Branch' }).last().click();
      await expect(page.getByTestId(`branch-row-${code}`)).toContainText('Closed');

      const branches = await api.branches.list();
      expect(branches.find((b) => b.code === code)?.isActive).toBe(false);

      expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
      expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
    });
  }
});
