import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { testPassword } from '@data/env';
import { Role } from '@data/users';
import { go } from '@utils/navigation';
import { VIEWPORTS, Viewport, measureOverflow, overflowProblem, useStyle, watch } from '@utils/layout';

const LONG_WORDS: string = 'Extraordinarily long and winding product name that keeps going well past what fits on a phone screen';
const UNBROKEN: string = 'Unbroken'.padEnd(95, 'W');

interface Seeds {
  readonly itemId: string;
  readonly productId: string;
  readonly customerId: string;
  readonly userId: string;
  readonly orderId: string;
  readonly longItemId: string;
  readonly unbrokenItemId: string;
  readonly longProductId: string;
  readonly unbrokenProductId: string;
  readonly longCustomerId: string;
  readonly unbrokenCustomerId: string;
  readonly longUserId: string;
  readonly unbrokenUserId: string;
}

let seeds: Seeds;

test.beforeAll(async ({ playwright }) => {
  const context = await playwright.request.newContext();
  const api = new Api(context);
  const mx = new ManagementExtraApi(api.client);
  const stamp = Date.now().toString(36);
  const longName = `${LONG_WORDS} ${stamp}`.slice(0, 95);
  const unbroken = `${UNBROKEN}${stamp}`.slice(0, 95);
  // Customer and user names are limited to 50 characters.
  const longPerson = longName.slice(0, 49);
  const unbrokenPerson = unbroken.slice(0, 49);

  const item = await api.items.create({ startingQuantity: 12 });
  const product = await api.products.create();
  const customer = await api.customers.create();
  const user = await api.users.create();
  const order = await api.orders.create({ items: [{ productId: product.id, quantity: 2 }] });
  const longItem = await api.items.create({ name: longName });
  const unbrokenItem = await api.items.create({ name: unbroken });
  const longProduct = await api.products.create({ name: longName });
  const unbrokenProduct = await api.products.create({ name: unbroken });
  const longCustomer = await mx.post('customers', mx.customerBody({ firstName: longPerson, lastName: 'LongOne' }));
  const unbrokenCustomer = await mx.post('customers', mx.customerBody({ firstName: unbrokenPerson, lastName: 'UnbrokenOne' }));
  const longUser = await mx.post('users', mx.userBody(testPassword(), { firstName: longPerson, lastName: 'LongOne' }));
  const unbrokenUser = await mx.post('users', mx.userBody(testPassword(), { firstName: unbrokenPerson, lastName: 'UnbrokenOne' }));

  seeds = {
    itemId: item.id,
    productId: product.id,
    customerId: customer.id,
    userId: user.id,
    orderId: order.id,
    longItemId: longItem.id,
    unbrokenItemId: unbrokenItem.id,
    longProductId: longProduct.id,
    unbrokenProductId: unbrokenProduct.id,
    longCustomerId: (await longCustomer.json()).id,
    unbrokenCustomerId: (await unbrokenCustomer.json()).id,
    longUserId: (await longUser.json()).id,
    unbrokenUserId: (await unbrokenUser.json()).id,
  };
  await context.dispose();
});

interface PageCase {
  readonly name: string;
  readonly path: () => string;
}

const ADMIN_PAGES: ReadonlyArray<PageCase> = [
  { name: 'dashboard', path: () => '/dashboard' },
  { name: 'orders list', path: () => '/orders/list' },
  { name: 'order editor', path: () => '/orders/editor' },
  { name: 'order details', path: () => `/orders/details/${seeds.orderId}` },
  { name: 'items', path: () => '/inventory/items' },
  { name: 'item details', path: () => `/inventory/items/details/${seeds.itemId}` },
  { name: 'new item', path: () => '/inventory/items/new' },
  { name: 'stock in', path: () => '/inventory/stock-in' },
  { name: 'needs attention', path: () => '/inventory/attention' },
  { name: 'waste', path: () => '/inventory/waste' },
  { name: 'coverage', path: () => '/inventory/coverage' },
  { name: 'products', path: () => '/management/products' },
  { name: 'product details', path: () => `/management/products/details/${seeds.productId}` },
  { name: 'new product', path: () => '/management/products/new' },
  { name: 'customers', path: () => '/management/customers' },
  { name: 'customer details', path: () => `/management/customers/details/${seeds.customerId}` },
  { name: 'users', path: () => '/management/users' },
  { name: 'user details', path: () => `/management/users/details/${seeds.userId}` },
  { name: 'promotions', path: () => '/management/promotions' },
  { name: 'reports', path: () => '/management/reports' },
  { name: 'waste reasons', path: () => '/management/waste-reasons' },
  { name: 'notifications', path: () => '/notifications' },
];

const SUPERADMIN_PAGES: ReadonlyArray<PageCase> = [
  { name: 'audit logs', path: () => '/management/audit-logs' },
  { name: 'schema scripts', path: () => '/management/schema-scripts' },
];

const CASHIER_PAGES: ReadonlyArray<PageCase> = [
  { name: 'order editor', path: () => '/orders/editor' },
  { name: 'orders list', path: () => '/orders/list' },
  { name: 'order details', path: () => `/orders/details/${seeds.orderId}` },
];

async function expectPageSettled(page: Page): Promise<void> {
  await expect(page.getByRole('heading').or(page.getByPlaceholder(/search/i)).first()).toBeVisible();
  await expect(page.locator('.loading-spinner:visible, .loading-lg:visible')).toHaveCount(0);
}

async function sweep(page: Page, viewport: Viewport, label: string, pages: ReadonlyArray<PageCase>): Promise<void> {
  const watcher = watch(page);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  for (const target of pages) {
    watcher.reset();
    const where = `${label} / ${viewport.name} / ${target.name}`;
    await go(page, target.path());
    await expectPageSettled(page);

    expect.soft(overflowProblem(await measureOverflow(page)), `${where}: horizontal overflow`).toBeNull();
    expect.soft(watcher.pageErrors, `${where}: uncaught page errors`).toEqual([]);
    expect.soft(watcher.consoleErrors, `${where}: console errors`).toEqual([]);
  }
}

// One small test per role, viewport and page, so they run side by side instead of three long walks.
test.describe('no sideways scroll, no errors on the main pages @layout', () => {
  const groups: ReadonlyArray<{ readonly label: string; readonly role: Role; readonly pages: ReadonlyArray<PageCase> }> = [
    { label: 'admin', role: 'admin', pages: ADMIN_PAGES },
    { label: 'super admin', role: 'superadmin', pages: SUPERADMIN_PAGES },
    { label: 'cashier', role: 'cashier', pages: CASHIER_PAGES },
  ];

  for (const viewport of VIEWPORTS) {
    for (const group of groups) {
      for (const target of group.pages) {
        test(`${group.label} ${target.name} at ${viewport.name}`, async ({ signIn }) => {
          const page = await signIn(group.role);
          await sweep(page, viewport, group.label, [target]);
        });
      }
    }
  }
});

test.describe('the Cafe style keeps the layout intact on a phone @layout', () => {
  const phone = VIEWPORTS[0];
  const PAGES: ReadonlyArray<PageCase> = [
    { name: 'orders list', path: () => '/orders/list' },
    { name: 'items', path: () => '/inventory/items' },
    { name: 'product details', path: () => `/management/products/details/${seeds.productId}` },
    { name: 'dashboard', path: () => '/dashboard' },
  ];

  test('cafe style at phone width', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await useStyle(page, 'cafe');

    await sweep(page, phone, 'admin cafe', PAGES);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cafe');
  });

  test('default style at phone width stays on the light theme', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await useStyle(page, 'light');

    await sweep(page, phone, 'admin light', PAGES.slice(0, 2));

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

interface LongCase {
  readonly name: string;
  readonly role: Role;
  readonly path: () => string;
  readonly needle: string;
}

const LONG_PAGES: ReadonlyArray<LongCase> = [
  { name: 'item details, long words', role: 'admin', path: () => `/inventory/items/details/${seeds.longItemId}`, needle: 'Extraordinarily' },
  { name: 'item details, unbroken', role: 'admin', path: () => `/inventory/items/details/${seeds.unbrokenItemId}`, needle: 'Unbroken' },
  { name: 'product details, long words', role: 'admin', path: () => `/management/products/details/${seeds.longProductId}`, needle: 'Extraordinarily' },
  { name: 'product details, unbroken', role: 'admin', path: () => `/management/products/details/${seeds.unbrokenProductId}`, needle: 'Unbroken' },
  { name: 'customer details, long words', role: 'admin', path: () => `/management/customers/details/${seeds.longCustomerId}`, needle: 'Extraordinarily' },
  { name: 'customer details, unbroken', role: 'admin', path: () => `/management/customers/details/${seeds.unbrokenCustomerId}`, needle: 'Unbroken' },
  { name: 'user details, long words', role: 'admin', path: () => `/management/users/details/${seeds.longUserId}`, needle: 'Extraordinarily' },
  { name: 'user details, unbroken', role: 'admin', path: () => `/management/users/details/${seeds.unbrokenUserId}`, needle: 'Unbroken' },
  { name: 'product editor, unbroken', role: 'admin', path: () => `/management/products/edit/${seeds.unbrokenProductId}`, needle: 'Unbroken' },
  { name: 'item editor, unbroken', role: 'admin', path: () => `/inventory/items/edit/${seeds.unbrokenItemId}`, needle: 'Unbroken' },
];

test.describe('long names do not push the layout sideways @layout', () => {
  for (const viewport of VIEWPORTS.slice(0, 2)) {
    test(`details and editor titles at ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('admin');
      const watcher = watch(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const target of LONG_PAGES) {
        watcher.reset();
        const where = `${viewport.name} / ${target.name}`;
        await go(page, target.path());
        const title = page.getByRole('heading', { level: 1 }).filter({ hasText: target.needle }).first();
        await expect(title, `${where}: title visible`).toBeVisible();

        const box = await title.boundingBox();
        expect.soft(box && box.x + box.width, `${where}: title stays inside the window`).toBeLessThanOrEqual(viewport.width + 1);
        expect.soft(box && box.x, `${where}: title starts inside the window`).toBeGreaterThanOrEqual(-1);
        if (viewport.width < 640) {
          expect.soft(box?.height ?? 0, `${where}: phone title is limited to two lines`).toBeLessThan(110);
        }

        expect.soft(overflowProblem(await measureOverflow(page)), `${where}: horizontal overflow`).toBeNull();
        expect.soft(watcher.pageErrors, `${where}: page errors`).toEqual([]);
      }
    });
  }

  test('lists with long names fit on a phone', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await page.setViewportSize({ width: 375, height: 812 });
    const lists = [
      { name: 'item list', path: '/inventory/items' },
      { name: 'product list', path: '/management/products' },
      { name: 'customer list', path: '/management/customers' },
      { name: 'user list', path: '/management/users' },
    ];

    for (const list of lists) {
      await go(page, list.path);
      const search = page.getByPlaceholder(/search/i).and(page.locator('input')).first();
      await search.fill('Unbroken');
      await expect(page.getByText('UnbrokenWWW').first(), `${list.name}: the unbroken name is listed`).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${list.name}: horizontal overflow`).toBeNull();
    }
  });
});
