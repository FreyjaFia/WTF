import { expect, test } from '@fixtures/index';
import { ShopSession } from '@api/shop-session';
import { TENANT_STATUS } from '@api/platform';
import { LoginPage } from '@pages/login.page';
import { testPassword } from '@data/env';
import { USERNAMES } from '@data/users';
import { openShop } from '@utils/tenants';

const SUSPENDED_MESSAGE = 'This shop\'s account is suspended. Please contact support.';

test.describe('suspending and resuming a shop @tenancy @suspend', () => {
  test('a suspended shop is refused at sign in, on every request and on refresh, and a resume brings it all back', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const drink = await shop.owner.createProduct();
    expect((await shop.owner.call('GET', 'products')).ok()).toBeTruthy();

    await platform.setStatus(shop.id, 'suspend', 'Unpaid');

    const signIn = await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword);
    expect(signIn.ok()).toBeFalsy();
    expect(await signIn.text()).toContain(SUSPENDED_MESSAGE);

    const read = await shop.owner.call('GET', 'products');
    expect(read.status()).toBe(403);
    expect(await read.text()).toContain(SUSPENDED_MESSAGE);
    const write = await shop.owner.createOrderRaw(drink.id);
    expect(write.status()).toBe(403);
    expect((await shop.owner.refresh()).ok()).toBeFalsy();

    await platform.setStatus(shop.id, 'resume');

    const again = await ShopSession.signIn(request, shop.ownerUsername, shop.ownerPassword);
    expect((await again.call('GET', 'products')).ok()).toBeTruthy();
    expect((await shop.owner.call('GET', 'products')).ok()).toBeTruthy();
    expect((await shop.owner.createOrderRaw(drink.id)).ok()).toBeTruthy();
    expect((await shop.owner.refresh()).ok()).toBeTruthy();
  });

  test('suspending one shop leaves every other shop working', async ({ request, platform }) => {
    const suspended = await openShop(request, platform);
    const other = await openShop(request, platform);
    const firstShop = await ShopSession.signIn(request, USERNAMES.cashier, testPassword());

    await platform.setStatus(suspended.id, 'suspend');

    expect((await suspended.owner.call('GET', 'products')).status()).toBe(403);
    expect((await other.owner.call('GET', 'products')).ok()).toBeTruthy();
    expect((await firstShop.call('GET', 'products')).ok()).toBeTruthy();
  });

  test('the sign in page keeps a suspended shop\'s people out, then lets them in after a resume', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    await platform.setStatus(shop.id, 'suspend');
    const page = await (await newContext()).newPage();
    const login = new LoginPage(page);

    await login.signIn(shop.ownerUsername, shop.ownerPassword);

    await expect(page.getByRole('alert')).toContainText(SUSPENDED_MESSAGE);
    await expect(page.getByRole('alert')).not.toContainText('Invalid username or password');
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();

    await platform.setStatus(shop.id, 'resume');
    await login.signIn(shop.ownerUsername, shop.ownerPassword);

    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  });

  test('a person already inside the app is signed out with the suspended message once the shop is suspended', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const customer = await shop.owner.createCustomer('Visible Before');
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto('/management/customers');
    await expect(page.getByText(customer.firstName).first()).toBeVisible();

    await platform.setStatus(shop.id, 'suspend');
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toContainText(SUSPENDED_MESSAGE);
    await expect(page.getByText(customer.firstName)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('a cancelled shop is refused too and cannot be resumed', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    const cancelled = await platform.setStatus(shop.id, 'cancel');
    expect(cancelled.status).toBe(TENANT_STATUS.Cancelled);

    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeFalsy();
    expect((await shop.owner.call('GET', 'products')).status()).toBe(403);
    const resume = await platform.call('POST', `tenants/${shop.id}/resume`, { reason: 'E2E' });
    expect(resume.status()).toBe(400);
  });

  test('only a running shop can be suspended, and each change lands in the platform log', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    await platform.setStatus(shop.id, 'suspend', 'Late payment');
    const twice = await platform.call('POST', `tenants/${shop.id}/suspend`, { reason: 'again' });
    expect(twice.status()).toBe(400);
    await platform.setStatus(shop.id, 'resume');

    const actions = (await platform.auditLog(shop.id)).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['TenantCreated', 'TenantSuspended', 'TenantResumed']));
    const suspended = (await platform.auditLog(shop.id)).find((entry) => entry.action === 'TenantSuspended');
    expect(suspended?.details).toContain('Late payment');
    expect(suspended?.username).toBeTruthy();
  });

  test('a shop person cannot reach the platform, and the platform token is no shop token', async ({ request, platform }) => {
    const shop = await openShop(request, platform);

    expect((await platform.call('GET', 'tenants', undefined, shop.owner.accessToken)).status()).toBe(403);
    expect((await platform.call('GET', 'tenants', undefined, null)).status()).toBe(401);
    const platformToken = await platform.token();
    const asShop = await ShopSession.withToken(request, 'platform', platformToken).call('GET', 'products');
    expect(asShop.ok()).toBeFalsy();
  });
});
