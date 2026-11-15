import { expect, test } from '@fixtures/index';
import { testPassword } from '@data/env';
import { ROLE_IDS } from '@data/users';
import { LoginPage } from '@pages/login.page';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';
import { openShop } from '@utils/tenants';
import { unique, uniqueUsername } from '@utils/unique';

const SHOTS = 'test-results/users-over-cap';

interface PlanRow {
  readonly id: number;
}

interface Cap {
  readonly maxUsers: number | null;
  readonly activeUsers: number;
  readonly usersOverCap: number;
}

test.describe('the users over the plan cap warning @plans @users', () => {
  for (const viewport of VIEWPORTS) {
    test(`shows on the Users list and the plan page at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const code = unique('e2e-cap').replace(/\s/g, '-');
      const plan = await platform.json<PlanRow>('POST', 'plans', { code, name: 'Cap test', monthlyPrice: 1, features: [], maxUsers: 5, isActive: true });
      const shop = await openShop(request, platform);
      await platform.setSubscription(shop.id, { planId: plan.id });
      for (let i = 0; i < 2; i++) {
        await shop.owner.json('POST', 'users', {
          firstName: unique('Staff'),
          lastName: 'E2E',
          username: uniqueUsername(),
          password: testPassword(),
          roleId: ROLE_IDS.Cashier,
        });
      }

      const within = await shop.owner.json<Cap>('GET', 'subscription');
      expect(within.usersOverCap).toBe(0);

      const lowered = await platform.call('PUT', `plans/${plan.id}`, { name: 'Cap test', monthlyPrice: 1, features: [], maxUsers: 1, isActive: true });
      expect(lowered.ok()).toBeTruthy();
      const over = await shop.owner.json<Cap>('GET', 'subscription');
      expect(over.maxUsers).toBe(1);
      expect(over.usersOverCap).toBe(over.activeUsers - 1);
      expect(over.usersOverCap).toBeGreaterThan(0);

      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const tag = String(viewport.width);

      await page.goto('/management/users');
      const notice = page.getByTestId('users-over-cap');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('allows 1 active user');
      await expect(notice).toContainText(`Deactivate ${over.usersOverCap} user`);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `${SHOTS}/users-${tag}.png` });

      await page.goto('/management/shop/plan');
      await expect(page.getByTestId('users-over-cap')).toBeVisible();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `${SHOTS}/plan-${tag}.png` });
    });
  }

  test('stays away while the shop is within its cap', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await (await newContext({ width: 1440, height: 900 })).newPage();
    await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await page.goto('/management/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(page.getByTestId('users-over-cap')).toHaveCount(0);
  });
});
