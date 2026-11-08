import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { LoginPage } from '@pages/login.page';
import { uniqueCode } from '@utils/unique';
import { openShop } from '@utils/tenants';

const ENDED_MESSAGE = 'This shop\'s subscription has ended. Please contact the shop owner or support to renew.';

test.describe('a shop whose subscription has lapsed @tenancy @subscription', () => {
  test('can sign in and read everything but every write is refused with 402', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const drink = await shop.owner.createProduct();
    const customer = await shop.owner.createCustomer();
    const order = await shop.owner.createOrder(drink.id);

    await platform.lapse(shop.id);

    const signedIn = await ShopSession.signIn(request, shop.ownerUsername, shop.ownerPassword);
    for (const path of ['products', 'customers', `orders/${order.id}`, 'orders/paged?page=1&pageSize=10', 'subscription']) {
      const read = await signedIn.call('GET', path);
      expect(read.ok(), `GET ${path} -> ${read.status()}`).toBeTruthy();
    }

    const newOrder = await signedIn.createOrderRaw(drink.id);
    expect(newOrder.status()).toBe(402);
    expect(await newOrder.text()).toContain(ENDED_MESSAGE);

    const newProduct = await signedIn.call('POST', 'products', {
      name: 'Blocked', code: uniqueCode(), price: 10, category: 1, isAddOn: false, isActive: true, subCategory: null,
    });
    expect(newProduct.status()).toBe(402);
    const newCustomer = await signedIn.call('POST', 'customers', { firstName: 'Blocked', lastName: 'E2E', address: 'x', contactNumber: '0917' });
    expect(newCustomer.status()).toBe(402);
    const edit = await signedIn.call('DELETE', `customers/${customer.id}`);
    expect(edit.status()).toBe(402);

    const stillThere = await signedIn.json<{ id: string }[]>('GET', 'customers');
    expect(stillThere.map((row) => row.id)).toContain(customer.id);
  });

  test('reports its state to the app as locked', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    expect((await shop.owner.json<{ warning: string }>('GET', 'subscription')).warning).toBe('none');

    await platform.lapse(shop.id);

    const state = await shop.owner.json<{ warning: string; daysLeft: number }>('GET', 'subscription');
    expect(state.warning).toBe('locked');
    expect(state.daysLeft).toBeLessThanOrEqual(0);
  });

  test('one shop lapsing does not lock another', async ({ request, platform }) => {
    const lapsed = await openShop(request, platform);
    const healthy = await openShop(request, platform);
    const drink = await healthy.owner.createProduct();

    await platform.lapse(lapsed.id);

    expect((await healthy.owner.createOrderRaw(drink.id)).ok()).toBeTruthy();
    expect((await lapsed.owner.createOrderRaw(drink.id)).ok()).toBeFalsy();
  });

  test('is unlocked as soon as the platform marks a new invoice paid', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const drink = await shop.owner.createProduct();
    await platform.lapse(shop.id);
    expect((await shop.owner.createOrderRaw(drink.id)).status()).toBe(402);

    const invoice = await platform.createInvoice(shop.id, 1, 'E2E-PAID');
    expect((await shop.owner.createOrderRaw(drink.id)).status()).toBe(402);
    await platform.markPaid(invoice.id, 'E2E-PAID');

    await expect.poll(async () => (await shop.owner.createOrderRaw(drink.id)).status(), { timeout: 30_000 }).toBe(201);
    const state = await platform.subscription(shop.id);
    expect(state.warning).toBe('none');
    expect(state.invoices.map((row) => row.statusName)).toContain('Paid');
  });

  test('is unlocked when the platform moves the paid-until date forward', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const drink = await shop.owner.createProduct();
    await platform.lapse(shop.id);
    expect((await shop.owner.createOrderRaw(drink.id)).status()).toBe(402);

    const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await platform.setSubscription(shop.id, { periodEnd: nextMonth, graceDays: 7 });

    await expect.poll(async () => (await shop.owner.createOrderRaw(drink.id)).status(), { timeout: 30_000 }).toBe(201);
  });

  test('is still unlocked by a platform admin who looks in: suspending is separate from lapsing', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    await platform.lapse(shop.id);

    const status = (await platform.tenants()).find((tenant) => tenant.id === shop.id);
    expect(status?.statusName).toBe('Active');
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeTruthy();
  });

  test('sees the lock screen in the app with a way to check again and log out', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    await platform.lapse(shop.id);
    const page = await (await newContext()).newPage();

    await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    const lock = page.getByTestId('subscription-lock');
    await expect(lock).toBeVisible();
    await expect(lock).toContainText('Subscription ended');
    await expect(lock.getByRole('button', { name: 'Check again' })).toBeVisible();

    await platform.setSubscription(shop.id, { periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(), graceDays: 7 });
    await lock.getByRole('button', { name: 'Check again' }).click();

    await expect(lock).toHaveCount(0);
  });
});
