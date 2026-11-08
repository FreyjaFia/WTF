import { expect, test } from '@fixtures/index';
import { Page } from '@playwright/test';
import { ShopSession } from '@api/shop-session';
import { TENANT_STATUS, uniqueSlug } from '@api/platform';
import { testPassword } from '@data/env';
import { PLATFORM_ROUTES } from '@data/routes';
import { LoginPage } from '@pages/login.page';
import { PlatformLoginPage, PlatformShopPage, PlatformShopsPage } from '@pages/platform.page';
import { unique, uniqueStamp } from '@utils/unique';
import { openShop, ownerOf } from '@utils/tenants';

type NewContext = (options?: { width?: number; height?: number }) => Promise<import('@playwright/test').BrowserContext>;

async function platformPage(newContext: NewContext): Promise<Page> {
  const page = await (await newContext()).newPage();
  await new PlatformLoginPage(page).signIn();
  await page.waitForURL(/\/platform\/overview/);
  return page;
}

test.describe('managing shops from the platform @tenancy @platform', () => {
  test('creates a shop and shows the owner\'s one-time password once, which works at the shop sign in', async ({ request, platform, newContext }) => {
    const page = await platformPage(newContext);
    const shops = new PlatformShopsPage(page);
    const slug = uniqueSlug('ui-new');
    const name = unique('UI Created Shop');
    await shops.open();

    await shops.fillAndCreate({ name, slug, firstName: 'Una', lastName: 'Owner', username: `owner-${slug}`.slice(0, 50) });

    await expect(shops.secret).toBeVisible();
    const secret = await shops.secretValues();
    expect(secret.username).toBe(`owner-${slug}`.slice(0, 50));
    expect(secret.password.length).toBeGreaterThanOrEqual(8);
    await shops.secret.getByRole('button', { name: 'Done' }).click();
    await expect(shops.secret).toHaveCount(0);

    await expect(shops.row(slug)).toContainText(name);
    expect((await ShopSession.attempt(request, secret.username, secret.password)).ok()).toBeTruthy();
    expect((await platform.tenants()).map((tenant) => tenant.slug)).toContain(slug);
  });

  test('refuses a shop address that is taken, reserved or badly written', async ({ platform, newContext }) => {
    const existing = await platform.createShop();
    const page = await platformPage(newContext);
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await shops.fillAndCreate({ name: 'Dup', slug: existing.tenant.slug, firstName: 'A', lastName: 'B', username: `dup-${uniqueStamp()}` });
    await expect(shops.dialog.getByRole('alert')).toContainText(/already taken/i);

    await shops.dialog.getByLabel('Shop address').fill('admin');
    await shops.dialog.getByRole('button', { name: 'Create shop' }).click();
    await expect(shops.dialog.getByRole('alert')).toContainText(/reserved/i);

    await shops.dialog.getByLabel('Shop address').fill('Bad Address!');
    await expect(shops.dialog.getByRole('button', { name: 'Create shop' })).toBeDisabled();
  });

  test('lists shops, finds one by name and filters by status', async ({ platform, newContext }) => {
    const shop = await platform.createShop({ name: unique('Findable Shop') });
    const other = await platform.createShop();
    await platform.setStatus(other.tenant.id, 'suspend');
    const page = await platformPage(newContext);
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await shops.search.fill(shop.tenant.name);
    await expect(shops.row(shop.tenant.slug)).toBeVisible();
    await expect(shops.row(other.tenant.slug)).toHaveCount(0);

    await shops.search.fill(other.tenant.slug);
    await expect(shops.row(other.tenant.slug)).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByTestId('filter-status-3').check();
    await expect(shops.row(other.tenant.slug)).toBeVisible();
    await page.getByTestId('filter-status-3').uncheck();
    await page.getByTestId('filter-status-2').check();
    await expect(shops.row(other.tenant.slug)).toHaveCount(0);
  });

  test('suspends a shop with a reason, locks its people out, then resumes it', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);

    await detail.button('Suspend').click();
    await detail.reasonDialog.getByLabel(/^Reason/).fill('abc');
    await expect(detail.reasonDialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await detail.confirmWithReason('Payment overdue');

    await expect(detail.button('Resume')).toBeVisible();
    await expect(detail.button('Suspend')).toHaveCount(0);
    expect((await shop.owner.call('GET', 'products')).status()).toBe(403);
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeFalsy();

    await detail.button('Resume').click();
    await detail.confirmWithReason('Paid in full');

    await expect(detail.button('Suspend')).toBeVisible();
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeTruthy();
    expect((await shop.owner.call('GET', 'products')).ok()).toBeTruthy();
  });

  test('cancels a shop, which cannot be resumed, and only then offers permanent deletion', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await expect(detail.button('Delete permanently')).toHaveCount(0);

    await detail.button('Cancel').click();
    await detail.confirmWithReason('Customer left');

    await expect(detail.button('Delete permanently')).toBeVisible();
    await expect(detail.button('Resume')).toHaveCount(0);
    await expect(detail.button('Cancel')).toHaveCount(0);
    expect((await platform.tenants()).find((tenant) => tenant.id === shop.id)?.status).toBe(TENANT_STATUS.Cancelled);
  });

  test('deletes a cancelled shop for good only with its address and the admin password', async ({ platform, newContext }) => {
    const created = await platform.createShop();
    await platform.setStatus(created.tenant.id, 'cancel');
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(created.tenant.id);

    await detail.button('Delete permanently').click();
    const dialog = detail.reasonDialog;
    await expect(dialog.getByTestId('delete-counts')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Delete permanently' });
    await dialog.getByLabel(/^Type the shop address/).fill('wrong-address');
    await dialog.getByLabel('Your password').fill(testPassword());
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();

    await dialog.getByLabel(/^Type the shop address/).fill(created.tenant.slug);
    await dialog.getByLabel('Your password').fill(`${testPassword()}-wrong`);
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect((await platform.tenants()).map((tenant) => tenant.id)).toContain(created.tenant.id);

    await dialog.getByLabel('Your password').fill(testPassword());
    await confirm.click();

    await expect(page).toHaveURL(new RegExp(`${PLATFORM_ROUTES.shops}$`));
    await expect.poll(async () => (await platform.tenants()).map((tenant) => tenant.id)).not.toContain(created.tenant.id);
    const again = await platform.call('POST', 'tenants', {
      name: 'Reuse', slug: created.tenant.slug, ownerFirstName: 'A', ownerLastName: 'B', ownerUsername: `re-${uniqueStamp()}`,
    });
    expect(again.status()).toBe(400);
  });

  test('shops created at the same moment all succeed', async ({ platform }) => {
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => platform.createShopRaw()));

    expect(responses.map((response) => response.status())).toEqual([200, 200, 200, 200, 200]);
  });

  test('refuses to delete a shop that is still running', async ({ platform }) => {
    const created = await platform.createShop();

    const response = await platform.call('POST', `tenants/${created.tenant.id}/delete`, { slug: created.tenant.slug, adminPassword: testPassword() });

    expect(response.status()).toBe(400);
    expect((await platform.tenants()).map((tenant) => tenant.id)).toContain(created.tenant.id);
  });

  test('resets a person\'s password: the old one stops working, the one-time one works, sessions end', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('people');

    await detail.person(shop.ownerUsername).getByRole('button', { name: 'Reset password' }).click();

    await expect(detail.secret).toBeVisible();
    const username = (await detail.secret.getByTestId('secret-username').textContent())?.trim() ?? '';
    const fresh = (await detail.secret.getByTestId('secret-password').textContent())?.trim() ?? '';
    expect(username).toBe(owner.username);
    expect(fresh).not.toBe(shop.ownerPassword);
    expect((await ShopSession.attempt(request, shop.ownerUsername, shop.ownerPassword)).ok()).toBeFalsy();
    expect((await ShopSession.attempt(request, shop.ownerUsername, fresh)).ok()).toBeTruthy();
    expect((await shop.owner.refresh()).ok()).toBeFalsy();
    await detail.secret.getByRole('button', { name: 'Done' }).click();
    await expect(detail.secret).toHaveCount(0);
  });

  test('does not offer to reset or sign in as the shop\'s customer-link system account', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('people');

    await expect(page.getByTestId('people-list')).toContainText(shop.ownerUsername);
    await expect(detail.person('customer-link')).toHaveCount(0);
  });

  test('signs in as a shop person read-only: sees their data, cannot change it, and goes back to the platform', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const customer = await shop.owner.createCustomer('Seen By Support');
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('people');

    await detail.person(shop.ownerUsername).getByRole('button', { name: 'Sign in as' }).click();
    await detail.reasonDialog.getByLabel(/^Reason/).fill('abc');
    await expect(detail.reasonDialog.getByRole('button', { name: 'Sign in as this person' })).toBeDisabled();
    await detail.confirmWithReason('Checking the till report', 'Sign in as this person');

    const bar = page.getByRole('status').filter({ hasText: 'Signed in as' });
    await expect(bar).toContainText(shop.ownerUsername);
    await expect(bar).toContainText('read-only');
    await page.goto('/management/customers');
    await expect(page.getByText(customer.firstName).first()).toBeVisible();

    await bar.getByRole('button', { name: 'Back to platform' }).click();
    await expect(page).toHaveURL(/\/platform\//);
    await expect(bar).toHaveCount(0);
  });

  test('a read-only sign in as someone refuses every change, and one that allows changes still cannot touch accounts', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);
    const drink = await shop.owner.createProduct();

    const readOnly = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, false)).accessToken);
    expect((await readOnly.call('GET', 'products')).ok()).toBeTruthy();
    expect((await readOnly.createOrderRaw(drink.id)).status()).toBe(403);

    const writer = ShopSession.withToken(request, owner.username, (await platform.impersonate(shop.id, owner.id, true)).accessToken);
    expect((await writer.createOrderRaw(drink.id)).ok()).toBeTruthy();
    const account = await writer.call('POST', 'users', { firstName: 'N', lastName: 'M', username: `no-${uniqueStamp()}`, password: testPassword(), roleId: 2 });
    expect(account.status()).toBe(403);

    const log = (await platform.auditLog(shop.id)).map((entry) => entry.action);
    expect(log).toEqual(expect.arrayContaining(['ImpersonationStarted', 'ImpersonatedAction']));
  });

  test('requires a reason to sign in as someone', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const owner = await ownerOf(platform, shop);

    const response = await platform.call('POST', `tenants/${shop.id}/users/${owner.id}/impersonate`, { reason: '', allowWrites: false });

    expect(response.ok()).toBeFalsy();
  });

  test('the shop page tabs show the people, billing, brand and log of that shop', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await expect(detail.title).toHaveText(shop.name);

    await detail.openTab('people');
    await expect(page.getByTestId('people-list')).toContainText(shop.ownerUsername);
    await detail.openTab('billing');
    await expect(page.getByTestId('billing-summary')).toContainText('Pro');
    await detail.openTab('brand');
    await expect(page.getByTestId('brand-form')).toBeVisible();
    await detail.openTab('log');
    await expect(page.getByTestId('shop-log')).toContainText('TenantCreated');
  });

  test('shows the platform admin that a shop that was not found is not found', async ({ newContext }) => {
    const page = await platformPage(newContext);

    await page.goto(PLATFORM_ROUTES.shop('11111111-2222-3333-4444-555555555555'));

    await expect(page.getByText('That shop was not found.')).toBeVisible();
  });

  test('the people of a shop are only that shop\'s', async ({ request, platform, newContext }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shopA.id);
    await detail.openTab('people');

    await expect(page.getByTestId('people-list')).toContainText(shopA.ownerUsername);
    await expect(page.getByTestId('people-list')).not.toContainText(shopB.ownerUsername);
  });

  test('the shop owner can sign in to the app with the one-time password', async ({ platform, newContext }) => {
    const created = await platform.createShop();
    const page = await (await newContext()).newPage();

    await new LoginPage(page).signIn(created.ownerUsername, created.temporaryPassword);

    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  });
});
