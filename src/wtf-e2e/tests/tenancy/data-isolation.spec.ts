import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { testPassword } from '@data/env';
import { USERNAMES } from '@data/users';
import { LoginPage } from '@pages/login.page';
import { unique, uniqueStamp } from '@utils/unique';
import { openShop } from '@utils/tenants';

interface Row {
  readonly id: string;
  readonly username?: string;
}

function ids(rows: readonly Row[]): string[] {
  return rows.map((row) => row.id);
}

test.describe('shops cannot see each other @tenancy @isolation', () => {
  test('a new shop starts without the products, customers or orders of another shop', async ({ request, platform }) => {
    const firstShop = await ShopSession.signIn(request, USERNAMES.owner, testPassword());
    const product = await firstShop.createProduct(unique('First shop drink'));
    const customer = await firstShop.createCustomer();
    const order = await firstShop.createOrder(product.id);

    const second = await openShop(request, platform);

    const products = await second.owner.json<Row[]>('GET', 'products');
    const customers = await second.owner.json<Row[]>('GET', 'customers');
    const orders = await second.owner.json<{ items: Row[] }>('GET', 'orders/paged?page=1&pageSize=100');
    expect(ids(products)).not.toContain(product.id);
    expect(ids(customers)).not.toContain(customer.id);
    expect(ids(orders.items)).not.toContain(order.id);
    expect(products).toHaveLength(0);
    expect(customers).toHaveLength(0);
    expect(orders.items).toHaveLength(0);
  });

  test('what one shop adds never shows up in the other, in either direction', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);

    const drinkA = await shopA.owner.createProduct(unique('Shop A drink'));
    const drinkB = await shopB.owner.createProduct(unique('Shop B drink'));
    const customerA = await shopA.owner.createCustomer(unique('A customer'));
    const customerB = await shopB.owner.createCustomer(unique('B customer'));
    const orderA = await shopA.owner.createOrder(drinkA.id);
    const orderB = await shopB.owner.createOrder(drinkB.id, 2);

    const seenByA = {
      products: ids(await shopA.owner.json<Row[]>('GET', 'products')),
      customers: ids(await shopA.owner.json<Row[]>('GET', 'customers')),
      orders: ids((await shopA.owner.json<{ items: Row[] }>('GET', 'orders/paged?page=1&pageSize=100')).items),
    };
    const seenByB = {
      products: ids(await shopB.owner.json<Row[]>('GET', 'products')),
      customers: ids(await shopB.owner.json<Row[]>('GET', 'customers')),
      orders: ids((await shopB.owner.json<{ items: Row[] }>('GET', 'orders/paged?page=1&pageSize=100')).items),
    };

    expect(seenByA.products).toEqual([drinkA.id]);
    expect(seenByA.customers).toEqual([customerA.id]);
    expect(seenByA.orders).toEqual([orderA.id]);
    expect(seenByB.products).toEqual([drinkB.id]);
    expect(seenByB.customers).toEqual([customerB.id]);
    expect(seenByB.orders).toEqual([orderB.id]);
  });

  test('a shop cannot open, change or delete the records of another shop by id', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const drinkA = await shopA.owner.createProduct(unique('Private drink'));
    const customerA = await shopA.owner.createCustomer(unique('Private customer'));
    const orderA = await shopA.owner.createOrder(drinkA.id);

    expect((await shopB.owner.call('GET', `products/${drinkA.id}`)).ok()).toBeFalsy();
    expect((await shopB.owner.call('GET', `customers/${customerA.id}`)).ok()).toBeFalsy();
    expect((await shopB.owner.call('GET', `orders/${orderA.id}`)).ok()).toBeFalsy();

    const edit = await shopB.owner.call('PUT', `products/${drinkA.id}`, { id: drinkA.id, name: 'Hijacked', price: 1 });
    expect(edit.ok()).toBeFalsy();
    const remove = await shopB.owner.call('DELETE', `customers/${customerA.id}`);
    expect(remove.ok()).toBeFalsy();

    const stillThere = await shopA.owner.json<{ name: string }>('GET', `products/${drinkA.id}`);
    expect(stillThere.name).toBe(drinkA.name);
    expect(ids(await shopA.owner.json<Row[]>('GET', 'customers'))).toContain(customerA.id);
  });

  test('order numbers count up inside each shop on their own', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const drinkA = await shopA.owner.createProduct();
    const drinkB = await shopB.owner.createProduct();

    const a1 = await shopA.owner.createOrder(drinkA.id);
    const a2 = await shopA.owner.createOrder(drinkA.id);
    const b1 = await shopB.owner.createOrder(drinkB.id);

    expect(a2.orderNumber).toBe(a1.orderNumber + 1);
    expect(b1.orderNumber).toBe(a1.orderNumber);
  });

  test('the people list, reports and audit log of a shop hold only its own data', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const drinkB = await shopB.owner.createProduct();
    await shopB.owner.createOrder(drinkB.id);

    const people = (await shopA.owner.json<Row[]>('GET', 'users')).map((person) => person.username);
    expect(people).toContain(shopA.ownerUsername);
    expect(people).not.toContain(shopB.ownerUsername);
    expect(people).not.toContain(USERNAMES.cashier);

    const today = new Date().toISOString().slice(0, 10);
    const sales = await shopA.owner.call('GET', `reports/daily-sales?fromDate=${today}&toDate=${today}`);
    expect(sales.ok(), await sales.text()).toBeTruthy();
    expect(await sales.text()).not.toContain(drinkB.name);

    const logs = await shopA.owner.call('GET', 'audit-logs');
    expect(await logs.text()).not.toContain(shopB.ownerUsername);
  });

  test('a username belongs to one shop only', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);

    const taken = await platform.call('POST', 'tenants', {
      name: unique('Second shop'),
      slug: `dupe-${uniqueStamp()}`,
      ownerFirstName: 'Dupe',
      ownerLastName: 'Owner',
      ownerUsername: shopA.ownerUsername,
    });

    expect(taken.status()).toBe(400);
    expect(await taken.text()).toContain('Username already exists');
  });

  test('the browser of one shop never lists the products of another', async ({ request, platform, newContext }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const drinkA = await shopA.owner.createProduct(unique('Only in A'));
    const drinkB = await shopB.owner.createProduct(unique('Only in B'));

    const context = await newContext();
    const page = await context.newPage();
    await new LoginPage(page).signIn(shopA.ownerUsername, shopA.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await page.goto('/management/products');
    await expect(page.getByText(drinkA.name)).toBeVisible();
    await expect(page.getByText(drinkB.name)).toHaveCount(0);
  });
});
