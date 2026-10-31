import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { today } from '@utils/dates';

interface ProfitRow {
  readonly productName: string;
  readonly quantitySold: number;
  readonly revenue: number;
  readonly cost: number | null;
  readonly grossProfit: number | null;
  readonly costStatus: string;
}

test.describe('the Product Profit report @reports', () => {
  test('a sold product shows the cost its stock movements recorded', async ({ api }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'ml', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const date = today();
    const rows = await api.client.json<ProfitRow[]>('superadmin', 'GET', `reports/product-margin?fromDate=${date}&toDate=${date}`);
    const row = rows.find((r) => r.productName === latte.name);
    expect(row?.quantitySold).toBe(2);
    expect(row?.revenue).toBe(300);
    expect(row?.cost).toBe(40);
    expect(row?.grossProfit).toBe(260);
    expect(row?.costStatus).toBe('Known');
  });

  test('a product that takes no stock shows no cost and no profit', async ({ api }) => {
    const water = await api.products.create({ price: 20 });
    await api.orders.create({ items: [{ productId: water.id, quantity: 1 }] });

    const date = today();
    const rows = await api.client.json<ProfitRow[]>('superadmin', 'GET', `reports/product-margin?fromDate=${date}&toDate=${date}`);
    const row = rows.find((r) => r.productName === water.name);
    expect(row?.cost).toBeNull();
    expect(row?.grossProfit).toBeNull();
    expect(row?.costStatus).toBe('No cost');
  });

  test('the cashier cannot read it', async ({ api }) => {
    const date = today();
    const response = await api.client.call('cashier', 'GET', `reports/product-margin?fromDate=${date}&toDate=${date}`);
    expect(response.status()).toBe(403);
  });

  test('the report opens from the catalog and shows the product with its profit', async ({ api, signIn }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'ml', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const page = await signIn('admin');
    await page.goto(ROUTES.report('product-margin'));
    await expect(page.getByRole('heading', { name: /product profit/i }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: latte.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: '260.00' }).first()).toBeVisible();
  });
});
