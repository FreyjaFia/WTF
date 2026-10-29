import { expect, test } from '@fixtures/index';
import { testPassword } from '@data/env';
import { ROUTES } from '@data/routes';
import { USERNAMES } from '@data/users';
import { LoginPage } from '@pages/login.page';
import { go } from '@utils/navigation';

const INVALID_CREDENTIALS = 'Invalid username or password.';

test.describe('signing in with bad details @auth', () => {
  test('a wrong password keeps the person on the login page with one clear message', async ({ page }) => {
    const login = new LoginPage(page);

    await login.signIn(USERNAMES.cashier, `${testPassword()}-wrong`);

    await expect(page.getByRole('alert')).toContainText(INVALID_CREDENTIALS);
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('an unknown username gets the same message as a wrong password', async ({ page }) => {
    const login = new LoginPage(page);

    await login.signIn('nobody-by-this-name', testPassword());

    await expect(page.getByRole('alert')).toContainText(INVALID_CREDENTIALS);
    await expect(page).toHaveURL(/\/login/);
  });

  test('the sign in button stays off until both fields are filled', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();

    await expect(login.submit).toBeDisabled();
    await login.username.fill(USERNAMES.cashier);
    await expect(login.submit).toBeDisabled();
    await login.password.fill(testPassword());
    await expect(login.submit).toBeEnabled();
  });

  test('a deleted user can no longer sign in', async ({ api, page }) => {
    const user = await api.users.create();
    await api.users.remove(user.id);
    const login = new LoginPage(page);

    await login.signIn(user.username, testPassword());

    await expect(page.getByRole('alert')).toContainText(INVALID_CREDENTIALS);
    await expect(page).toHaveURL(/\/login/);
  });

  test('the login API answers a wrong password and an unknown user the same way', async ({ api }) => {
    const wrongPassword = await api.client.login(USERNAMES.cashier, 'definitely-not-it');
    const unknownUser = await api.client.login('nobody-by-this-name', 'definitely-not-it');

    expect(wrongPassword.status()).toBe(unknownUser.status());
    expect([400, 401]).toContain(wrongPassword.status());
    expect(await wrongPassword.text()).toBe(await unknownUser.text());
  });
});

test.describe('a signed-out or expired session @auth', () => {
  for (const path of [ROUTES.dashboard, ROUTES.ordersList, ROUTES.items, ROUTES.waste]) {
    test(`opening ${path} while signed out sends the person to the login page`, async ({ page }) => {
      await go(page, path);

      await expect(page).toHaveURL(/\/login/);
    });
  }

  test('a token the server does not accept is cleared and the person sees the login page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.open();
    await page.evaluate(() => {
      localStorage.setItem('token', 'not.a.real.token');
      localStorage.setItem('refreshToken', 'not-a-real-refresh-token');
    });

    await go(page, ROUTES.dashboard);

    await expect(page).toHaveURL(/\/login/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('a cashier who opens a management page is not shown it', async ({ signIn }) => {
    const page = await signIn('cashier');

    await go(page, ROUTES.auditLogs);

    await expect(page).not.toHaveURL(/audit-logs/);
  });
});
