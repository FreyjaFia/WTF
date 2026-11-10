import { expect, test } from '@fixtures/index';
import { testPassword } from '@data/env';
import { PLATFORM_ROUTES } from '@data/routes';
import { LoginPage } from '@pages/login.page';
import { PlatformLoginPage, PlatformShell } from '@pages/platform.page';
import { openShop } from '@utils/tenants';

test.describe('platform admin sign in @tenancy @platform', () => {
  test('a wrong password keeps the person on the platform login with a message', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    const login = new PlatformLoginPage(page);

    await login.signIn(undefined, `${testPassword()}-wrong`);

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/platform\/login/);
  });

  test('the sign in button stays off until both fields are filled', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    const login = new PlatformLoginPage(page);
    await login.open();

    await expect(login.submit).toBeDisabled();
    await login.username.fill('platformadmin');
    await expect(login.submit).toBeDisabled();
    await login.password.fill('x');
    await expect(login.submit).toBeEnabled();
  });

  test('the right name and password open the platform on its overview with the sidebar', async ({ newContext }) => {
    const page = await (await newContext()).newPage();

    await new PlatformLoginPage(page).signIn();

    await expect(page).toHaveURL(/\/platform\/overview/);
    const shell = new PlatformShell(page);
    for (const name of ['Overview', 'Shops', 'Plans', 'Logs'] as const) {
      await expect(shell.link(name)).toBeVisible();
    }
  });

  test('the platform pages need a platform sign in', async ({ newContext }) => {
    const page = await (await newContext()).newPage();

    for (const route of [PLATFORM_ROUTES.home, PLATFORM_ROUTES.shops, PLATFORM_ROUTES.plans, PLATFORM_ROUTES.log]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/platform\/login/);
    }
  });

  test('signing out returns to the login and closes the platform pages again', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signIn();
    const shell = new PlatformShell(page);
    await expect(shell.signOutButton).toBeVisible();

    await shell.signOutButton.click();

    await expect(page).toHaveURL(/\/platform\/login/);
    await page.goto(PLATFORM_ROUTES.shops);
    await expect(page).toHaveURL(/\/platform\/login/);
  });

  test('a shop person who is signed in cannot use the platform pages', async ({ request, platform, newContext }) => {
    const shop = await openShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.ownerUsername, shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await page.goto(PLATFORM_ROUTES.shops);

    await expect(page).toHaveURL(/\/platform\/login/);
  });

  test('a platform sign in does not open the shop app', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signIn();
    await expect(page).toHaveURL(/\/platform\/overview/);

    await page.goto('/management/products');

    await expect(page).toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/platform\//);
  });

  test('an unknown platform account is refused every time and does not disturb the real admin', async ({ platform }) => {
    // Uses an account name that does not exist, so the real platform admin is never locked out of the other tests.
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await platform.login('no-such-admin', 'wrong-password-123');
      expect(response.status()).toBe(401);
    }

    expect((await platform.login('platformadmin', testPassword())).ok()).toBeTruthy();
  });
});
