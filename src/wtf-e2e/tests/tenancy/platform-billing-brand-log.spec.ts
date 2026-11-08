import { expect, test } from '@fixtures/index';
import { Page } from '@playwright/test';
import { PLATFORM_ROUTES } from '@data/routes';
import { PlatformLoginPage, PlatformShell, PlatformShopPage } from '@pages/platform.page';
import { unique } from '@utils/unique';
import { openShop } from '@utils/tenants';

async function platformPage(newContext: () => Promise<import('@playwright/test').BrowserContext>): Promise<Page> {
  const page = await (await newContext()).newPage();
  await new PlatformLoginPage(page).signIn();
  await page.waitForURL(/\/platform\/overview/);
  return page;
}

interface Brand {
  readonly shopName: string;
  readonly phone?: string | null;
  readonly tagline?: string | null;
  readonly primaryColor: string;
}

test.describe('plans, subscriptions and invoices @tenancy @platform @billing', () => {
  test('lists the plans and edits one, and the new price reaches the next invoice', async ({ platform, newContext }) => {
    const [starter] = (await platform.plans()).filter((plan) => plan.code === 'starter');
    const page = await platformPage(newContext);
    await new PlatformShell(page).link('Plans').click();
    const card = page.getByTestId('plan-starter');
    await expect(page.getByTestId('plan-pro')).toBeVisible();
    await expect(card).toBeVisible();

    try {
      await card.getByRole('button', { name: 'Edit plan' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit plan' });
      await dialog.getByLabel('Price per month').fill('1234.5');
      await dialog.getByRole('button', { name: 'Save plan' }).click();

      await expect(dialog).toHaveCount(0);
      await expect(card).toContainText('1,234.5');
      const saved = (await platform.plans()).find((plan) => plan.code === 'starter');
      expect(saved?.monthlyPrice).toBe(1234.5);
    } finally {
      await platform.call('PUT', `plans/${starter.id}`, {
        name: starter.name, monthlyPrice: starter.monthlyPrice, features: starter.features, maxUsers: starter.maxUsers, isActive: starter.isActive,
      });
    }
  });

  test('rejects a plan with no name or a negative price', async ({ platform }) => {
    const [starter] = (await platform.plans()).filter((plan) => plan.code === 'starter');

    const noName = await platform.call('PUT', `plans/${starter.id}`, { name: ' ', monthlyPrice: 10, features: [], maxUsers: null, isActive: true });
    const negative = await platform.call('PUT', `plans/${starter.id}`, { name: 'X', monthlyPrice: -1, features: [], maxUsers: null, isActive: true });

    expect(noName.status()).toBe(400);
    expect(negative.status()).toBe(400);
  });

  test('changes a shop\'s plan, grace days and discount from its Billing tab', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('billing');
    const form = page.locator('form').filter({ hasText: 'Grace days' });
    await expect(form.getByLabel('Grace days')).toHaveValue('7');

    await form.getByLabel('Grace days').fill('14');
    await form.getByLabel('Discount %').fill('10');
    await form.getByLabel('Notes').fill('Pilot discount');
    await form.getByRole('button', { name: 'Save subscription' }).click();

    await expect.poll(async () => (await platform.subscription(shop.id)).graceDays).toBe(14);
    const saved = await platform.subscription(shop.id);
    expect(saved).toMatchObject({ graceDays: 14, discountPercent: 10 });
  });

  test('creates an invoice, marks it paid and pushes the paid-until date out', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const before = await platform.subscription(shop.id);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('billing');
    const list = page.getByTestId('invoice-list');
    await expect(list).toContainText('No invoices yet.');

    const form = page.locator('form').filter({ hasText: 'Months' });
    await form.getByLabel('Months').fill('3');
    await form.getByLabel('Reference').fill('INV-E2E-1');
    await form.getByRole('button', { name: 'New invoice' }).click();

    await expect(list).toContainText('3 month(s)');
    await expect(list).toContainText('Open');
    await list.getByRole('button', { name: 'Mark paid' }).click();
    await expect(list).toContainText('Paid');
    await expect(list.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);

    const after = await platform.subscription(shop.id);
    expect(new Date(after.periodEnd).getTime()).toBeGreaterThan(new Date(before.periodEnd).getTime());
  });

  test('voids an open invoice, which leaves the paid-until date alone', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const before = await platform.subscription(shop.id);
    await platform.createInvoice(shop.id, 1, 'INV-VOID');
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('billing');
    const list = page.getByTestId('invoice-list');

    await list.getByRole('button', { name: 'Void' }).click();

    await expect(list).toContainText('Void');
    await expect(list.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
    expect((await platform.subscription(shop.id)).periodEnd).toBe(before.periodEnd);
  });

  test('a full year costs ten months of the plan price, less any discount', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const plan = (await platform.plans()).find((row) => row.code === 'pro');

    const year = await platform.createInvoice(shop.id, 12);
    const month = await platform.createInvoice(shop.id, 1);

    expect(year.amount).toBe((plan?.monthlyPrice ?? 0) * 10);
    expect(month.amount).toBe(plan?.monthlyPrice);
  });

  test('a paid invoice cannot be voided and a void one cannot be paid', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const paid = await platform.createInvoice(shop.id, 1);
    await platform.markPaid(paid.id);
    const voided = await platform.createInvoice(shop.id, 1);
    await platform.voidInvoice(voided.id);

    expect((await platform.call('POST', `invoices/${paid.id}/void`)).ok()).toBeFalsy();
    expect((await platform.call('POST', `invoices/${voided.id}/mark-paid`, { reference: null })).ok()).toBeFalsy();
  });

  test('the shop owner sees the shop\'s own subscription', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const other = await openShop(request, platform);
    await platform.setSubscription(other.id, { graceDays: 30 });

    const mine = await shop.owner.json<{ managed: boolean; planCode: string; graceDays: number }>('GET', 'subscription');
    const theirs = await other.owner.json<{ graceDays: number }>('GET', 'subscription');

    expect(mine).toMatchObject({ managed: true, planCode: 'pro', graceDays: 7 });
    expect(theirs.graceDays).toBe(30);
  });
});

test.describe('shop brand from the platform @tenancy @platform @brand', () => {
  test('saves the brand of a shop, and the shop sees its own name and phone', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('brand');
    const form = page.getByTestId('brand-form');
    const newName = unique('Rebranded');

    await form.getByLabel('Shop name').fill(newName);
    await form.getByLabel('Phone').fill('0917 555 0101');
    await form.getByLabel('Tagline').fill('Fresh daily');
    await form.getByRole('button', { name: 'Save brand' }).click();

    await expect.poll(async () => (await platform.json<Brand>('GET', `tenants/${shop.id}/brand`)).shopName).toBe(newName);
    const seenByShop = await shop.owner.json<Brand>('GET', 'settings/brand');
    expect(seenByShop).toMatchObject({ shopName: newName, phone: '0917 555 0101', tagline: 'Fresh daily' });
  });

  test('one shop\'s brand never reaches another', async ({ request, platform }) => {
    const shopA = await openShop(request, platform);
    const shopB = await openShop(request, platform);
    const current = await platform.json<Brand>('GET', `tenants/${shopA.id}/brand`);

    await platform.json('PUT', `tenants/${shopA.id}/brand`, { ...current, shopName: unique('Only A') });

    const seenByB = await shopB.owner.json<Brand>('GET', 'settings/brand');
    expect(seenByB.shopName).toBe(shopB.name);
  });

  test('refuses a colour that is too pale to read', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const current = await platform.json<Brand>('GET', `tenants/${shop.id}/brand`);

    const response = await platform.call('PUT', `tenants/${shop.id}/brand`, { ...current, primaryColor: '#fefefe' });

    expect(response.status()).toBe(400);
  });

  test('refuses an empty shop name from the Brand tab', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await platformPage(newContext);
    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('brand');
    const form = page.getByTestId('brand-form');

    await form.getByLabel('Shop name').fill('');

    await expect(form.getByRole('button', { name: 'Save brand' })).toBeDisabled();
  });
});

test.describe('the platform log @tenancy @platform @audit', () => {
  test('records who did what to which shop, and the shop page and the full log agree', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    await platform.setStatus(shop.id, 'suspend', 'Audit trail check');
    await platform.setStatus(shop.id, 'resume');
    const page = await platformPage(newContext);

    await new PlatformShell(page).link('Platform log').click();
    await expect(page).toHaveURL(new RegExp(`${PLATFORM_ROUTES.log}$`));
    await page.getByLabel('Filter by shop').selectOption({ label: shop.name });

    const list = page.getByTestId('log-list');
    await expect(list).toContainText('TenantCreated');
    await expect(list).toContainText('TenantSuspended');
    await expect(list).toContainText('Audit trail check');
    await expect(list).toContainText('TenantResumed');
    await expect(list).toContainText('platformadmin');

    await page.getByLabel('Search the log').fill('Audit trail check');
    await expect(list.getByRole('listitem')).toHaveCount(1);

    const detail = new PlatformShopPage(page);
    await detail.open(shop.id);
    await detail.openTab('log');
    await expect(page.getByTestId('shop-log')).toContainText('TenantSuspended');
  });

  test('records platform sign ins, including failed ones, without ever writing a password', async ({ platform }) => {
    await platform.login('platformadmin', 'definitely-wrong-password-xyz');

    const entries = await platform.auditLog(null, 300);
    const text = JSON.stringify(entries);

    expect(entries.map((entry) => entry.action)).toEqual(expect.arrayContaining(['Login', 'LoginFailed']));
    expect(text).not.toContain('definitely-wrong-password-xyz');
  });

  test('a password reset is logged without the new password', async ({ request, platform }) => {
    const shop = await openShop(request, platform);
    const people = await platform.users(shop.id);
    const owner = people.find((person) => person.username === shop.ownerUsername);

    const reset = await platform.resetPassword(shop.id, owner?.id ?? '');

    const entries = await platform.auditLog(shop.id);
    expect(entries.map((entry) => entry.action)).toContain('PasswordReset');
    expect(JSON.stringify(entries)).not.toContain(reset.temporaryPassword);
    expect(JSON.stringify(entries)).not.toContain(shop.ownerPassword);
  });

  test('the overview counts the shops and links to the shop list', async ({ request, platform, newContext }) => {
    await openShop(request, platform);
    const page = await platformPage(newContext);
    const total = (await platform.tenants()).length;

    await expect(page.getByTestId('stat-total')).toHaveText(String(total), { timeout: 30_000 });
    await page.getByTestId('overview-stats').getByRole('link', { name: /Shops/ }).click();

    await expect(page).toHaveURL(new RegExp(`${PLATFORM_ROUTES.shops}$`));
  });
});
