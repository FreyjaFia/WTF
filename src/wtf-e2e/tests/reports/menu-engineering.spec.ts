import { expect, test } from '@fixtures/index';
import { PromotionsExtra } from '@api/promotions-extra';
import { Category, SubCategory } from '@data/enums';
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

  test('a refunded order does not change the profit per unit of the sales that stayed', async ({ api }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });
    const refunded = await api.orders.create({ items: [{ productId: latte.id, quantity: 3 }] });
    const response = await api.orders.voidOrder(refunded.id, 'Customer changed their mind');
    expect(response.ok()).toBeTruthy();

    const date = today();
    const rows = await api.client.json<MenuRow[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    const row = rows.find((r) => r.productName === latte.name);
    expect(row?.quantitySold).toBe(2);
    expect(row?.unitProfit).toBe(130);
  });

  test('add-ons are not menu items, and the drink keeps its own profit', async ({ api }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const { drink, size } = await api.products.withSize(150, 20);
    await api.items.linkProducts(milk.id, [{ productId: drink.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: drink.id, quantity: 2, addOns: [{ productId: size.id, quantity: 1 }] }] });

    const date = today();
    const rows = await api.client.json<MenuRow[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    expect(rows.find((r) => r.productName === size.name)).toBeUndefined();
    const row = rows.find((r) => r.productName === drink.name);
    expect(row?.quantitySold).toBe(2);
    expect(row?.unitProfit).toBe(130);
  });

  test('a bundle is not a menu item', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const latte = await api.products.create({ price: 100 });
    const croissant = await api.products.create({ price: 120 });
    const bundle = await promos.fixedBundle([latte.id, croissant.id], 150);
    await promos.sell(
      [
        { productId: latte.id, quantity: 1, bundleId: bundle.id },
        { productId: croissant.id, quantity: 1, bundleId: bundle.id },
      ],
      [{ promotionId: bundle.id, quantity: 1 }],
    );

    const date = today();
    const rows = await api.client.json<(MenuRow & { categoryName: string })[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
    expect(rows.find((r) => r.productName === bundle.name)).toBeUndefined();
    expect(rows.filter((r) => r.categoryName === 'Promotions')).toHaveLength(0);
  });

  test('the category filter keeps only that category', async ({ api }) => {
    const drink = await api.products.create({ price: 100 });
    const food = await api.products.create({ price: 80, category: Category.Food, subCategory: SubCategory.Snacks });
    await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }, { productId: food.id, quantity: 1 }] });

    const date = today();
    const rows = await api.client.json<MenuRow[]>('superadmin', 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}&categoryId=${Category.Food}`);
    expect(rows.find((r) => r.productName === food.name)).toBeDefined();
    expect(rows.find((r) => r.productName === drink.name)).toBeUndefined();
  });

  test('the admin viewer can open the report and sees the product', async ({ api, signIn }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });

    const page = await signIn('viewer');
    await page.goto(ROUTES.report('menu-engineering'));
    await expect(page.getByRole('heading', { name: /menu engineering/i }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: latte.name })).toBeVisible();
  });

  test('the stock manager and item manager cannot open it', async ({ api }) => {
    const date = today();
    for (const role of ['stockmgr', 'itemmgr'] as const) {
      const response = await api.client.call(role, 'GET', `reports/menu-engineering?fromDate=${date}&toDate=${date}`);
      expect(response.status()).toBe(403);
    }
  });
});
