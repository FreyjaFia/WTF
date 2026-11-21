import { mkdirSync } from 'node:fs';
import { ROUTES } from '@data/routes';
import { expect, test } from '@fixtures/index';
import { OrderEditorPage } from '@pages/order-editor.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/branch-prices';

function branchCode(): string {
  return unique('P').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-5);
}

interface BranchPrices {
  readonly shopPrice: number;
  readonly branches: readonly { branchId: string; price: number | null; effectivePrice: number }[];
}

test.describe('prices by branch @management @branches', () => {
  test('a branch price is used for the menu and the sale in that branch only, and clearing it goes back to the shop price', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const main = await api.branches.main();
      const { drink, size } = await api.products.withSize(160, 20);
      const inBranch = { 'X-Branch-Id': branch.id };
      const inMain = { 'X-Branch-Id': main.id };

      const save = await api.client.call('owner', 'PUT', `products/${drink.id}/branch-prices`, { body: [{ branchId: branch.id, price: 175 }] });
      expect(save.status(), await save.text()).toBe(200);
      const sizeSave = await api.client.call('owner', 'PUT', `products/${size.id}/branch-prices`, { body: [{ branchId: branch.id, price: 25 }] });
      expect(sizeSave.status(), await sizeSave.text()).toBe(200);

      const catalogOf = async (headers: Record<string, string>): Promise<{ drink: number; size: number }> => {
        const catalog = (await (await api.client.call('owner', 'GET', 'sync/pos-catalog', { headers })).json()) as {
          products: { id: string; price: number }[];
          addOnsByProductId: Record<string, { options: { id: string; price: number }[] }[]>;
        };
        return {
          drink: catalog.products.find((p) => p.id === drink.id)!.price,
          size: catalog.addOnsByProductId[drink.id].flatMap((g) => g.options).find((o) => o.id === size.id)!.price,
        };
      };

      expect(await catalogOf(inBranch)).toEqual({ drink: 175, size: 25 });
      expect(await catalogOf(inMain)).toEqual({ drink: 160, size: 20 });

      const orderBody = {
        ...api.orders.body({ items: [{ productId: drink.id, quantity: 1, addOns: [{ productId: size.id, quantity: 1 }] }] }),
      };
      const sold = (await (await api.client.call('owner', 'POST', 'orders', { body: orderBody, headers: inBranch })).json()) as { id: string; totalAmount: number };
      expect(sold.totalAmount).toBe(200);
      const soldInMain = (await (await api.client.call('owner', 'POST', 'orders', { body: orderBody, headers: inMain })).json()) as { totalAmount: number };
      expect(soldInMain.totalAmount).toBe(180);

      const clear = await api.client.call('owner', 'PUT', `products/${drink.id}/branch-prices`, { body: [{ branchId: branch.id, price: null }] });
      expect(clear.status(), await clear.text()).toBe(200);
      expect((await catalogOf(inBranch)).drink).toBe(160);

      const earlier = (await (await api.client.call('owner', 'GET', `orders/${sold.id}`, { headers: inBranch })).json()) as { totalAmount: number };
      expect(earlier.totalAmount, 'a sale already made keeps the price it was made at').toBe(200);
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('branch prices are checked, and only people who may edit products can change them', async ({ api }) => {
    const branch = await api.branches.create(branchCode());
    try {
      const product = await api.products.create({ price: 100 });
      const put = (role: 'owner' | 'cashier' | 'viewer', price: number | null) =>
        api.client.call(role, 'PUT', `products/${product.id}/branch-prices`, { body: [{ branchId: branch.id, price }] });

      for (const bad of [0, -1, 1000000, 10.555]) {
        expect((await put('owner', bad)).status(), `price ${bad}`).toBe(400);
      }

      expect((await put('cashier', 120)).status()).toBe(403);
      expect((await put('viewer', 120)).status()).toBe(403);

      const unknown = await api.client.call('owner', 'PUT', `products/${product.id}/branch-prices`, { body: [{ branchId: '11111111-1111-1111-1111-111111111111', price: 120 }] });
      expect(unknown.status()).toBe(400);

      expect((await put('owner', 120)).status()).toBe(200);
      const read = (await (await api.client.call('viewer', 'GET', `products/${product.id}/branch-prices`)).json()) as BranchPrices;
      expect(read.shopPrice).toBe(100);
      expect(read.branches.find((b) => b.branchId === branch.id)).toMatchObject({ price: 120, effectivePrice: 120 });
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`the owner sets a branch price, sees it on the product and on the register at ${viewport.name}`, async ({ signIn, api }) => {
      const branch = await api.branches.create(branchCode(), unique('Harbor'));
      mkdirSync(SHOTS, { recursive: true });
      try {
        const main = await api.branches.main();
        const product = await api.products.create({ name: unique('Branch Latte'), price: 160 });

        const page = await signIn('owner');
        const watcher = watch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), main.id);

        await go(page, `/management/products/edit/${product.id}`);
        const card = page.getByTestId('branch-prices-card');
        await expect(card).toBeVisible();
        const row = page.getByTestId(`branch-price-row-${branch.code}`);
        await expect(row).toContainText('Charges ₱160.00');
        await expect(row).toContainText('(shop price)');
        await page.screenshot({ path: `${SHOTS}/editor-before-${viewport.width}.png` });

        await page.getByTestId(`branch-price-input-${branch.code}`).fill('175');
        await expect(row).toContainText('Charges ₱175.00');
        await expect(page.getByTestId(`branch-price-reset-${branch.code}`)).toBeVisible();
        await page.getByTestId(`branch-price-input-${branch.code}`).fill('0');
        await expect(row).toContainText('Enter a price from 0.01');
        await expect(page.getByRole('button', { name: 'Update Product' })).toBeDisabled();
        await page.screenshot({ path: `${SHOTS}/editor-error-${viewport.width}.png` });
        await page.getByTestId(`branch-price-input-${branch.code}`).fill('175');
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: editor overflow`).toBeNull();

        await page.getByRole('button', { name: 'Update Product' }).click();
        await expect(page).toHaveURL(new RegExp(`/management/products/details/${product.id}`));
        const detail = page.getByTestId(`branch-price-${branch.code}`);
        await expect(detail).toContainText('Own price');
        await expect(detail).toContainText('175.00');
        await expect(page.getByTestId(`branch-price-${main.code}`)).toContainText('Shop price');
        await page.screenshot({ path: `${SHOTS}/details-${viewport.width}.png` });
        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: details overflow`).toBeNull();

        // The register of that branch charges the branch price; the main branch still charges the shop price.
        await page.evaluate((id: string) => localStorage.setItem('wtf_active_branch', id), branch.id);
        await page.addInitScript((id: string) => localStorage.setItem('wtf_active_branch', id), branch.id);
        await go(page, ROUTES.orderEditor);
        const editor = new OrderEditorPage(page);
        await editor.search.waitFor();
        await editor.search.fill(product.name);
        await expect(editor.product(product.name)).toContainText('175.00');
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
