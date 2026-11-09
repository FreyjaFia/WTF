import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { measureOverflow, overflowProblem, useStyle, VIEWPORTS } from '@utils/layout';

interface ProfitTiles {
  readonly netSales: number;
  readonly stockValue: number;
  readonly costStatus: string;
  readonly wasteCost: number;
}

interface DashboardJson {
  readonly profit: ProfitTiles | null;
}

test.describe('the owner profit tiles on the dashboard @dashboard', () => {
  test('cost roles get the profit block and other dashboard roles are refused', async ({ api }) => {
    for (const role of ['owner', 'admin', 'viewer'] as const) {
      const dashboard = await api.client.json<DashboardJson>(role, 'GET', 'dashboard');
      expect(dashboard.profit, role).not.toBeNull();
    }

    for (const role of ['cashier', 'stockmgr', 'itemmgr'] as const) {
      const response = await api.client.call(role, 'GET', 'dashboard');
      expect(response.status(), role).toBe(403);
    }
  });

  test('the tiles show on screen and link to their reports', async ({ api, signIn }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const page = await signIn('admin');
    await page.goto(ROUTES.dashboard);
    await expect(page.getByTestId('tile-margin')).toBeVisible();
    await expect(page.getByTestId('tile-waste')).toBeVisible();
    await expect(page.getByTestId('tile-variance')).toBeVisible();
    await expect(page.getByTestId('tile-stock-value')).toContainText('PHP');

    await page.getByTestId('tile-margin').click();
    await expect(page).toHaveURL(/report=gross-profit/);
  });

  test('Admin Viewer sees the tiles', async ({ signIn }) => {
    const page = await signIn('viewer');
    await page.goto(ROUTES.dashboard);
    await expect(page.getByTestId('tile-stock-value')).toBeVisible();
  });

  for (const style of ['light', 'cafe'] as const) {
    for (const viewport of VIEWPORTS) {
      test(`no sideways scroll at ${viewport.name} in the ${style} style`, async ({ signIn }) => {
        const page = await signIn('admin');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(ROUTES.dashboard);
        await useStyle(page, style);
        await page.goto(ROUTES.dashboard);
        await expect(page.getByTestId('tile-margin')).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
      });
    }
  }
});
