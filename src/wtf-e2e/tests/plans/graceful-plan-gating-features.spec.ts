import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { PlatformApi } from '@api/platform';
import { LoginPage } from '@pages/login.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { openShop } from '@utils/tenants';

interface Screen {
  readonly feature: string;
  readonly label: RegExp;
  readonly hub: '/management' | '/inventory';
  readonly card: string;
}

// One screen per gated feature that is reached from a hub card. Custom roles is covered by the role editor save in
// graceful-plan-gating.spec.ts (the role list itself is open to every plan). Order links, chat and the monthly workbook
// have no hub card; the API test below covers what they answer.
const SCREENS: ReadonlyArray<Screen> = [
  { feature: 'expenses', label: /Expenses/, hub: '/management', card: 'management-card-expenses' },
  { feature: 'promotions', label: /Promotions/, hub: '/management', card: 'management-card-promotions' },
  { feature: 'audit', label: /Audit log/, hub: '/management', card: 'management-card-audit-logs' },
  { feature: 'inventory', label: /Inventory/, hub: '/inventory', card: 'inventory-card-items' },
  { feature: 'purchasing', label: /Purchasing/, hub: '/inventory', card: 'inventory-card-purchase-orders' },
];

const REFUSED_WITH_FEATURE: ReadonlyArray<{ path: string; feature: string }> = [
  { path: 'expenses', feature: 'expenses' },
  { path: 'management/promotions/discounted-products', feature: 'promotions' },
  { path: 'audit-logs', feature: 'audit' },
  { path: 'items', feature: 'inventory' },
  { path: 'reports/stock-status', feature: 'inventory' },
  { path: 'suppliers', feature: 'purchasing' },
  { path: 'purchase-orders', feature: 'purchasing' },
  { path: 'reports/customer-links', feature: 'orderlinks' },
  { path: 'conversations', feature: 'chat' },
  { path: 'reports/monthly-workbook/status', feature: 'workbook' },
];

async function planId(platform: PlatformApi, code: string): Promise<number> {
  const plan = (await platform.plans()).find((p) => p.code === code);
  if (!plan) {
    throw new Error(`Plan ${code} is not seeded.`);
  }

  return plan.id;
}

async function signInPage(page: Page, username: string, password: string): Promise<void> {
  await new LoginPage(page).signIn(username, password);
  await page.waitForURL((url) => !url.pathname.includes('login'));
}

test.describe('every gated screen after its feature left the plan @plans @layout', () => {
  for (const screen of SCREENS) {
    for (const viewport of VIEWPORTS) {
      test(`${screen.feature}: opening it from the hub goes to Not in your plan at ${viewport.name}`, async ({ newContext, request, platform }) => {
        const shop = await openShop(request, platform, { planCode: 'business' });
        const context = await newContext({ width: viewport.width, height: viewport.height });
        const page = await context.newPage();
        const watcher = watch(page);

        await signInPage(page, shop.ownerUsername, shop.ownerPassword);
        await go(page, screen.hub);
        const card = page.getByTestId(screen.card);
        await expect(card).toBeVisible();

        // The plan is changed after the hub loaded, so the app still holds the old one when the card is pressed.
        await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });
        await card.click();

        await expect(page).toHaveURL(new RegExp(`not-in-plan\\?feature=${screen.feature}`));
        await expect(page.getByTestId('not-in-plan-title')).toContainText(screen.label);
        await expect(page.getByText('Discard Changes?')).toHaveCount(0);
        await expect(page.locator('[role="alert"]')).toHaveCount(0);

        expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: horizontal overflow`).toBeNull();
        expect.soft(watcher.pageErrors, `${viewport.name}: uncaught page errors`).toEqual([]);
      });
    }
  }

  test('a core screen still opens after the redirect, and the refused feature is gone from the menu', async ({ newContext, request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    const context = await newContext({ width: 1440, height: 900 });
    const page = await context.newPage();

    await signInPage(page, shop.ownerUsername, shop.ownerPassword);
    await go(page, '/management');
    const card = page.getByTestId('management-card-expenses');
    await expect(card).toBeVisible();
    await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });
    await card.click();
    await expect(page).toHaveURL(/not-in-plan\?feature=expenses/);

    await go(page, '/management');
    await expect(page.getByTestId('management-hub')).toBeVisible();
    await expect(page.getByTestId('management-card-expenses')).toHaveCount(0);
    await expect(page.getByTestId('management-card-customers')).toBeVisible();
  });
});

test.describe('the API names the feature it refused @plans', () => {
  test('every gated route answers 403 not_in_plan with the feature key', async ({ request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'starter' });

    const created = await shop.owner.call('POST', 'roles', { name: 'Gate check', permissions: ['orders.read'] });
    expect(created.status(), 'POST roles').toBe(403);
    expect(await created.json(), 'POST roles').toMatchObject({ code: 'not_in_plan', feature: 'customroles' });

    for (const { path, feature } of REFUSED_WITH_FEATURE) {
      const response = await shop.owner.call('GET', path);
      expect(response.status(), path).toBe(403);
      expect(await response.json(), path).toMatchObject({ code: 'not_in_plan', feature });
    }
  });
});
