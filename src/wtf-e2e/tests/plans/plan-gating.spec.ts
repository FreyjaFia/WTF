import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { PlatformApi, PlatformPlan } from '@api/platform';
import { LoginPage } from '@pages/login.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { openShop, TestShop } from '@utils/tenants';
import { unique } from '@utils/unique';

interface PlanFeature {
  readonly key: string;
  readonly needs: ReadonlyArray<string>;
}

interface PlanRow {
  readonly id: number;
  readonly code: string;
  readonly features: ReadonlyArray<string>;
  readonly shopCount: number;
}

async function planByCode(platform: PlatformApi, code: string): Promise<PlatformPlan> {
  const plan = (await platform.plans()).find((p) => p.code === code);
  if (!plan) {
    throw new Error(`Plan ${code} is not seeded.`);
  }

  return plan;
}

async function planId(platform: PlatformApi, code: string): Promise<number> {
  return (await planByCode(platform, code)).id;
}

const FEATURE_PROBES: ReadonlyArray<{ feature: string; permission: string; route: string }> = [
  { feature: 'inventory', permission: 'items.read', route: 'items' },
  { feature: 'expenses', permission: 'expenses.read', route: 'expenses' },
  { feature: 'purchasing', permission: 'purchasing.read', route: 'purchase-orders' },
  { feature: 'audit', permission: 'audit.read', route: 'audit-logs' },
];

async function status(shop: TestShop, path: string, method: 'GET' | 'POST' = 'GET'): Promise<number> {
  return (await shop.owner.call(method, path)).status();
}

const GATED_ON_STARTER: ReadonlyArray<string> = [
  'items',
  'suppliers',
  'purchase-orders',
  'reorder',
  'expenses',
  'audit-logs',
  'management/promotions/discounted-products',
  'conversations',
  'reports/stock-status',
  'reports/waste',
  'reports/gross-profit',
  'reports/profit-loss',
  'reports/stock-variance',
  'reports/promotions',
  'reports/customer-links',
];

const OPEN_ON_STARTER: ReadonlyArray<string> = ['products', 'customers', 'subscription', 'auth/permissions'];

test.describe('plan gating on the API @plans', () => {
  test('a Starter shop is refused every gated route with not_in_plan, and still reaches the core ones', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'starter' });

    for (const path of GATED_ON_STARTER) {
      const response = await shop.owner.call('GET', path);
      expect(response.status(), path).toBe(403);
      expect(await response.json(), path).toMatchObject({ code: 'not_in_plan' });
    }

    for (const path of OPEN_ON_STARTER) {
      expect(await status(shop, path), path).toBe(200);
    }

    // Core reports need dates, so the answer is a validation error, never the plan refusal.
    expect(await status(shop, 'reports/daily-sales')).not.toBe(403);
  });

  test('a shop holds exactly the permissions of the features its plan lists', async ({ request, platform }) => {
    const plan = await planByCode(platform, 'pro');
    const shop = await openShop(request, platform, { planCode: 'pro' });
    const held = await shop.owner.json<string[]>('GET', 'auth/permissions');

    for (const probe of FEATURE_PROBES) {
      const inPlan = plan.features.includes(probe.feature);
      expect(held.includes(probe.permission), `${probe.permission} (${probe.feature})`).toBe(inPlan);
      expect(await status(shop, probe.route), probe.route).toBe(inPlan ? 200 : 403);
    }
  });

  test('a Business shop holds every permission', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    const held = await shop.owner.json<string[]>('GET', 'auth/permissions');

    for (const key of ['purchasing.write', 'suppliers.write', 'audit.read', 'reports.generate', 'chat.read']) {
      expect(held, key).toContain(key);
    }

    expect(await status(shop, 'purchase-orders')).toBe(200);
    expect(await status(shop, 'audit-logs')).toBe(200);
  });

  test('a plan change takes effect at once, and a downgrade then upgrade restores everything', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    expect(await status(shop, 'purchase-orders')).toBe(200);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });
    for (const path of ['items', 'purchase-orders', 'expenses', 'audit-logs']) {
      expect(await status(shop, path), path).toBe(403);
    }
    expect(await status(shop, 'products')).toBe(200);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'business') });
    for (const path of ['items', 'purchase-orders', 'expenses', 'audit-logs']) {
      expect(await status(shop, path), path).toBe(200);
    }
  });

  test('offline sync stays open after a downgrade', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'starter' });

    const response = await shop.owner.call('POST', 'orders/sync');
    expect(response.status()).not.toBe(403);
  });

  test('the shop sees which plans hold each feature', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'starter' });
    const mine = await shop.owner.json<{ features: string[]; plansByFeature: Record<string, string[]> }>('GET', 'subscription');
    const plans = (await platform.plans()).filter((p) => p.isActive);

    expect(mine.features).not.toContain('inventory');
    for (const feature of ['inventory', 'purchasing']) {
      const holders = plans.filter((p) => p.features.includes(feature)).map((p) => p.name);
      expect([...mine.plansByFeature[feature]].sort(), feature).toEqual(holders.sort());
    }
  });

  test('two shops on different plans never see each other\'s limits', async ({ request, platform }) => {
    const starter = await openShop(request, platform, { planCode: 'starter' });
    const business = await openShop(request, platform, { planCode: 'business' });

    expect(await status(starter, 'items')).toBe(403);
    expect(await status(business, 'items')).toBe(200);
  });
});

test.describe('platform plan editor rules @plans @platform', () => {
  test('the catalog is served with needs, and a plan rejects unknown words and adds needs', async ({ platform }) => {
    const catalog = await platform.json<PlanFeature[]>('GET', 'plan-features');
    expect(catalog.map((f) => f.key)).toEqual(
      expect.arrayContaining(['expenses', 'inventory', 'purchasing', 'promotions', 'orderlinks', 'chat', 'workbook', 'audit', 'customroles']),
    );
    expect(catalog.find((f) => f.key === 'purchasing')?.needs).toEqual(['inventory']);

    const code = unique('e2e').replace(/\s/g, '-');
    const bad = await platform.call('POST', 'plans', { code, name: 'Bad', monthlyPrice: 1, features: ['inventory', 'bogus'], maxUsers: null, isActive: true });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain('bogus');

    const created = await platform.json<PlanRow>('POST', 'plans', { code, name: 'Needs test', monthlyPrice: 1, features: ['purchasing', 'chat'], maxUsers: null, isActive: false });
    expect(created.features).toEqual(['inventory', 'purchasing', 'orderlinks', 'chat']);
    expect(created.shopCount).toBe(0);
  });

  test('a retired plan cannot be given to another shop, but a shop already on it keeps it', async ({ request, platform }) => {
    const code = unique('e2e-r').replace(/\s/g, '-');
    const created = await platform.json<PlanRow>('POST', 'plans', { code, name: 'Retiring', monthlyPrice: 1, features: ['expenses'], maxUsers: null, isActive: true });
    const shop = await openShop(request, platform);
    await platform.setSubscription(shop.id, { planId: created.id });

    const retired = await platform.call('PUT', `plans/${created.id}`, { name: 'Retiring', monthlyPrice: 1, features: ['expenses'], maxUsers: null, isActive: false });
    expect(retired.ok()).toBeTruthy();

    expect(await status(shop, 'expenses')).toBe(200);
    const other = await openShop(request, platform);
    const refused = await platform.call('PUT', `tenants/${other.id}/subscription`, {
      planId: created.id,
      periodEnd: null,
      graceDays: 7,
      discountPercent: 0,
      notes: null,
    });
    expect(refused.status()).toBe(400);
  });

  test('the plan-change preview lists what a downgrade hides, with counts', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    const starter = await planId(platform, 'starter');

    const preview = await platform.json<{ lostFeatures: { key: string; dataCount: number | null }[] }>(
      'GET',
      `tenants/${shop.id}/plan-change-preview?planId=${starter}`,
    );

    const keys = preview.lostFeatures.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['inventory', 'purchasing', 'expenses', 'audit']));
  });
});

async function signInPage(page: Page, shop: TestShop): Promise<void> {
  await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
  await page.waitForURL((url) => !url.pathname.includes('login'));
}

test.describe('plan gating in the app @plans @layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`a Starter shop has no gated menu entries and a direct URL lands on Not in your plan at ${viewport.name}`, async ({ newContext, request, platform }) => {
      const shop = await openShop(request, platform, { planCode: 'starter' });
      const context = await newContext({ width: viewport.width, height: viewport.height });
      const page = await context.newPage();
      const watcher = watch(page);

      await signInPage(page, shop);
      await expect(page.locator('app-sidebar nav a[title="Inventory"]')).toHaveCount(0);
      await go(page, '/management');
      await expect(page.getByTestId('management-hub')).toBeVisible();
      for (const card of ['expenses', 'promotions', 'audit-logs']) {
        await expect(page.getByTestId(`management-card-${card}`), card).toHaveCount(0);
      }

      await go(page, '/inventory/receiving');
      await expect(page).toHaveURL(/not-in-plan/);
      await expect(page.getByText(/not in your plan/i).first()).toBeVisible();
      await expect(page.getByText(/Business/).first()).toBeVisible();

      await go(page, '/management/expenses');
      await expect(page).toHaveURL(/not-in-plan/);

      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: horizontal overflow`).toBeNull();
      expect.soft(watcher.pageErrors, `${viewport.name}: uncaught page errors`).toEqual([]);
    });
  }

  test('after an upgrade the same address opens the screen', async ({ newContext, request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'starter' });
    const context = await newContext({ width: 1440, height: 900 });
    const page = await context.newPage();

    await signInPage(page, shop);
    await go(page, '/management/expenses');
    await expect(page).toHaveURL(/not-in-plan/);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'pro') });
    await go(page, '/management/expenses');
    await expect(page).toHaveURL(/management\/expenses/);
  });
});
