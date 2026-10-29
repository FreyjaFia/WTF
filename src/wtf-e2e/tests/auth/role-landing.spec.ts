import { expect, test } from '@fixtures/index';
import { LANDING_PATH, Role } from '@data/users';
import { go } from '@utils/navigation';

const ROLES: ReadonlyArray<Role> = ['superadmin', 'admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'];

test.describe('sign in lands each role on its own start page @auth', () => {
  for (const role of ROLES) {
    test(`${role} lands on ${LANDING_PATH[role]}`, async ({ signInViaUi }) => {
      const page = await signInViaUi(role);
      await expect(page).toHaveURL(new RegExp(`${LANDING_PATH[role]}$`));
    });
  }
});

test.describe('waste screens are limited by role @auth @waste', () => {
  test('cashier cannot open the waste list', async ({ signIn }) => {
    const page = await signIn('cashier');
    await page.goto('/inventory/waste');
    await expect(page).not.toHaveURL(/\/inventory\/waste$/);
  });

  test('item manager cannot open waste reasons', async ({ signIn }) => {
    const page = await signIn('itemmgr');
    await page.goto('/management/waste-reasons');
    await expect(page).not.toHaveURL(/waste-reasons$/);
  });

  test('stock manager can open the waste list but has no review tile', async ({ signIn }) => {
    const page = await signIn('stockmgr');
    await page.goto('/inventory/waste');
    await expect(page.getByRole('heading', { name: 'Waste', exact: true })).toBeVisible();
    await expect(page.getByTestId('tile-pending')).toHaveCount(0);
  });
});
