import { mkdirSync } from 'node:fs';
import { ROUTES } from '@data/routes';
import { expect, test } from '@fixtures/index';
import { OrderEditorPage } from '@pages/order-editor.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/product-sold-at';

function branchCode(): string {
  return unique('S').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-5);
}

interface SoldAt {
  readonly isAllBranches: boolean;
  readonly canChange: boolean;
  readonly branches: readonly { branchId: string; isSoldHere: boolean }[];
}

test.describe('products sold at some branches @management @branches', () => {
  test('a product limited to a branch is on that branch menu only, and can be sold everywhere again', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const product = await api.products.create({ price: 140 });
      const inBranch = { 'X-Branch-Id': branch.id };
      const inMain = { 'X-Branch-Id': main.id };
      const onMenu = async (headers: Record<string, string>): Promise<boolean> => {
        const catalog = (await (await api.client.call('owner', 'GET', 'sync/pos-catalog', { headers })).json()) as { products: { id: string }[] };
        return catalog.products.some((p) => p.id === product.id);
      };

      expect(await onMenu(inMain)).toBe(true);
      expect(await onMenu(inBranch)).toBe(true);

      const limit = await api.client.call('owner', 'PUT', `products/${product.id}/sold-at`, { body: { isAllBranches: false, branchIds: [branch.id] } });
      expect(limit.status(), await limit.text()).toBe(200);
      expect(await onMenu(inBranch)).toBe(true);
      expect(await onMenu(inMain)).toBe(false);

      const read = (await (await api.client.call('viewer', 'GET', `products/${product.id}/sold-at`)).json()) as SoldAt;
      expect(read.isAllBranches).toBe(false);
      expect(read.branches.find((b) => b.branchId === branch.id)?.isSoldHere).toBe(true);
      expect(read.branches.find((b) => b.branchId === main.id)?.isSoldHere).toBe(false);

      const everywhere = await api.client.call('owner', 'PUT', `products/${product.id}/sold-at`, { body: { isAllBranches: true, branchIds: null } });
      expect(everywhere.status(), await everywhere.text()).toBe(200);
      expect(await onMenu(inMain)).toBe(true);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('a sale still saves for a product the branch no longer sells, and the choice is checked and permissioned', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const product = await api.products.create({ price: 100 });
      const limit = await api.client.call('owner', 'PUT', `products/${product.id}/sold-at`, { body: { isAllBranches: false, branchIds: [branch.id] } });
      expect(limit.status()).toBe(200);

      const order = await api.client.call('owner', 'POST', 'orders', {
        body: api.orders.body({ items: [{ productId: product.id, quantity: 1, addOns: [] }] }),
        headers: { 'X-Branch-Id': main.id },
      });
      expect(order.status(), await order.text()).toBe(201);

      const put = (role: 'owner' | 'cashier' | 'viewer', body: unknown) => api.client.call(role, 'PUT', `products/${product.id}/sold-at`, { body });
      expect((await put('owner', { isAllBranches: false, branchIds: [] })).status()).toBe(400);
      expect((await put('owner', { isAllBranches: false, branchIds: ['11111111-1111-1111-1111-111111111111'] })).status()).toBe(400);
      expect((await put('cashier', { isAllBranches: true, branchIds: null })).status()).toBe(403);
      expect((await put('viewer', { isAllBranches: true, branchIds: null })).status()).toBe(403);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('a product created for one branch is on its menu only', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const name = unique('Branch Special');
      const created = await api.client.call('owner', 'POST', 'products', {
        body: { name, code: unique('SP').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8), price: 99, category: 1, isAddOn: false, isActive: true, subCategory: null, soldAtBranchIds: [branch.id] },
      });
      expect(created.status(), await created.text()).toBe(200);
      const { id, soldAtBranchIds } = (await created.json()) as { id: string; soldAtBranchIds: string[] };
      expect(soldAtBranchIds).toEqual([branch.id]);

      const idsOf = async (branchId: string): Promise<string[]> =>
        ((await (await api.client.call('owner', 'GET', 'sync/pos-catalog', { headers: { 'X-Branch-Id': branchId } })).json()) as { products: { id: string }[] }).products.map((p) => p.id);
      expect(await idsOf(branch.id)).toContain(id);
      expect(await idsOf(main.id)).not.toContain(id);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`the owner limits a product to a branch and sees it in the list, the details and the register at ${viewport.name}`, async ({ signIn, api }) => {
      const branch = await api.branches.create(branchCode(), unique('Harbor'));
      mkdirSync(SHOTS, { recursive: true });
      try {
        const main = await api.branches.main();
        const product = await api.products.create({ name: unique('Sold At Latte'), price: 160 });

        const page = await signIn('owner');
        const watcher = watch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);

        await go(page, `/management/products/edit/${product.id}`);
        const card = page.getByTestId('sold-at-card');
        await expect(card).toBeVisible();
        await expect(page.getByTestId('sold-at-summary')).toContainText('Every branch');
        await page.screenshot({ path: `${SHOTS}/editor-all-${viewport.width}.png` });

        await page.getByTestId('sold-at-some').check();
        await expect(page.getByTestId('sold-at-empty')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Update Product' })).toBeDisabled();
        await page.screenshot({ path: `${SHOTS}/editor-empty-${viewport.width}.png` });

        await page.getByTestId(`sold-at-check-${branch.code}`).check();
        await expect(page.getByTestId('sold-at-summary')).toContainText(`Only ${branch.name}`);
        await page.screenshot({ path: `${SHOTS}/editor-limited-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: editor overflow`).toBeNull();

        await page.getByRole('button', { name: 'Update Product' }).click();
        await expect(page).toHaveURL(new RegExp(`/management/products/details/${product.id}`));
        await expect(page.getByTestId(`sold-at-${branch.code}`)).toBeVisible();
        await expect(page.getByTestId(`sold-at-${main.code}`)).toHaveCount(0);
        await page.screenshot({ path: `${SHOTS}/details-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: details overflow`).toBeNull();

        await go(page, '/management/products');
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(page.getByTestId('sold-at-filter')).toBeVisible();
        await page.getByTestId(`sold-at-filter-${main.id}`).click();
        await page.screenshot({ path: `${SHOTS}/list-filter-${viewport.width}.png` });
        await page.keyboard.press('Escape');
        await page.getByPlaceholder('Search by product name').fill(product.name);
        await expect(page.getByTestId(`sold-at-chip-${await codeOf(api, product.id)}`)).toHaveCount(0);

        await page.getByRole('button', { name: /^Filters/ }).click();
        await page.getByTestId(`sold-at-filter-limited`).click();
        await page.keyboard.press('Escape');
        await expect(page.getByText(product.name).first()).toBeVisible();
        await expect(page.getByTestId(`sold-at-chip-${await codeOf(api, product.id)}`)).toContainText(`Only ${branch.name}`);
        await page.screenshot({ path: `${SHOTS}/list-limited-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: list overflow`).toBeNull();

        await go(page, ROUTES.orderEditor);
        const mainEditor = new OrderEditorPage(page);
        await mainEditor.search.waitFor();
        await mainEditor.search.fill(product.name);
        await expect(mainEditor.product(product.name)).toHaveCount(0);

        await page.evaluate((id: string) => localStorage.setItem('wtf_active_branch', id), branch.id);
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), branch.id);
        await go(page, ROUTES.orderEditor);
        const branchEditor = new OrderEditorPage(page);
        await branchEditor.search.waitFor();
        await branchEditor.search.fill(product.name);
        await expect(branchEditor.product(product.name)).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/register-branch-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: register overflow`).toBeNull();

        expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
        expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
      } finally {
        await api.branches.closeQuietly(branch.id);
      }
    });
  }
});

async function codeOf(api: { client: { call: (role: 'owner', method: string, path: string) => Promise<{ json: () => Promise<unknown> }> } }, id: string): Promise<string> {
  return ((await (await api.client.call('owner', 'GET', `products/${id}`)).json()) as { code: string }).code;
}
