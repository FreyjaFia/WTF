import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { today } from '@utils/dates';

interface MenuRow {
  readonly productName: string;
  readonly quantitySold: number;
  readonly unitProfit: number | null;
  readonly popularityPercent: number | null;
  readonly menuClass: string;
}

const CLASSES = ['Star', 'Plowhorse', 'Puzzle', 'Dog'];

test.describe('the Menu Engineering report @reports', () => {
  test('a product with a full cost is rated and shows its profit per unit', async ({ api }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const date = today();
    const rows = await api.client.json<MenuRow[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    const row = rows.find((r) => r.productName === latte.name);
    expect(row?.quantitySold).toBe(2);
    expect(row?.unitProfit).toBe(130);
    expect(CLASSES).toContain(row?.menuClass);
  });

  test('a product that takes no stock is not rated', async ({ api }) => {
    const water = await api.products.create({ price: 20 });
    await api.orders.create({ items: [{ productId: water.id, quantity: 1 }] });

    const date = today();
    const rows = await api.client.json<MenuRow[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    const row = rows.find((r) => r.productName === water.name);
    expect(row?.menuClass).toBe('Not rated');
    expect(row?.unitProfit).toBeNull();
    expect(row?.popularityPercent).toBeNull();
  });

  test('the cashier cannot read it', async ({ api }) => {
    const date = today();
    const response = await api.client.call('cashier', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    expect(response.status()).toBe(403);
  });

  test('the report opens from the catalog and shows the product with its class', async ({ api, signIn }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const page = await signIn('admin');
    await page.goto(ROUTES.report('menu-engineering'));
    await expect(page.getByRole('heading', { name: /menu engineering/i }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: latte.name })).toBeVisible();
    await expect(page.getByRole('cell', { name: '130.00' }).first()).toBeVisible();
  });
});
