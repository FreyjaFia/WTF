import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { PlatformApi } from '@api/platform';
import { LoginPage } from '@pages/login.page';
import { RoleEditorPage } from '@pages/roles.page';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { openShop, TestShop } from '@utils/tenants';
import { unique } from '@utils/unique';

async function planId(platform: PlatformApi, code: string): Promise<number> {
  const plan = (await platform.plans()).find((p) => p.code === code);
  if (!plan) {
    throw new Error(`Plan ${code} is not seeded.`);
  }

  return plan.id;
}

async function signInPage(page: Page, shop: TestShop): Promise<void> {
  await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
  await page.waitForURL((url) => !url.pathname.includes('login'));
}

async function typeRoleName(page: Page): Promise<RoleEditorPage> {
  const editor = new RoleEditorPage(page);
  await editor.openNew();
  await editor.name.fill(unique('Role'));
  await editor.permission('orders.read').click();
  return editor;
}

test.describe('a plan change while a screen is open @plans @layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`saving a role after Custom roles left the plan opens Not in your plan, not the Discard dialog at ${viewport.name}`, async ({ newContext, request, platform }) => {
      const shop = await openShop(request, platform, { planCode: 'business' });
      const context = await newContext({ width: viewport.width, height: viewport.height });
      const page = await context.newPage();
      const watcher = watch(page);

      await signInPage(page, shop);
      const editor = await typeRoleName(page);
      await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });

      await editor.save.click();

      await expect(page).toHaveURL(/not-in-plan\?feature=customroles/);
      await expect(page.getByTestId('not-in-plan-title')).toContainText('Custom roles');
      await expect(page.getByTestId('not-in-plan-not-saved')).toBeVisible();
      await expect(page.getByText('Discard Changes?')).toHaveCount(0);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);

      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: horizontal overflow`).toBeNull();
      expect.soft(watcher.pageErrors, `${viewport.name}: uncaught page errors`).toEqual([]);
    });
  }

  test('after the refusal the shop still works, and an upgrade brings the screen back', async ({ newContext, request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    const context = await newContext({ width: 1440, height: 900 });
    const page = await context.newPage();

    await signInPage(page, shop);
    const editor = await typeRoleName(page);
    await platform.setSubscription(shop.id, { planId: await planId(platform, 'starter') });
    await editor.save.click();
    await expect(page).toHaveURL(/not-in-plan/);

    await page.getByRole('link', { name: 'Go to Home' }).click();
    await expect(page).not.toHaveURL(/not-in-plan/);

    await platform.setSubscription(shop.id, { planId: await planId(platform, 'business') });
    await new RoleEditorPage(page).openNew();
    await expect(page).toHaveURL(/management\/roles\/new/);
  });

  test('leaving a dirty editor by the menu still asks first', async ({ newContext, request, platform }) => {
    const shop = await openShop(request, platform, { planCode: 'business' });
    const context = await newContext({ width: 1440, height: 900 });
    const page = await context.newPage();

    await signInPage(page, shop);
    await typeRoleName(page);

    await page.locator('app-sidebar nav a').first().click();

    await expect(page.getByText('Discard Changes?')).toBeVisible();
  });
});
