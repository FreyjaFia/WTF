import { ROUTES } from '@data/routes';
import { Role } from '@data/users';
import { expect, test } from '@fixtures/index';
import { VIEWPORTS } from '@utils/layout';
import { go } from '@utils/navigation';

const STALE_BRANCH = '5d1c6b0e-9a43-4f27-8f10-3b2e7c9d4a11';
const STORAGE_KEY = 'wtf_active_branch';
const ERROR_TEXT = /cannot use that branch/i;

const CASES: ReadonlyArray<{ readonly role: Role; readonly pages: ReadonlyArray<string> }> = [
  { role: 'owner', pages: [ROUTES.dashboard, ROUTES.ordersList, ROUTES.kitchen, ROUTES.items] },
  { role: 'cashier', pages: [ROUTES.ordersList, ROUTES.kitchen] },
];

test.describe('A saved branch that no longer exists @management @branches', () => {
  for (const viewport of VIEWPORTS) {
    for (const { role, pages } of CASES) {
      test(`${role} still gets in at ${viewport.name}, with no error card`, async ({ signIn }) => {
        const page = await signIn(role);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value);
          },
          [STORAGE_KEY, STALE_BRANCH],
        );

        for (const route of pages) {
          await go(page, route);
          await expect(page.locator('body')).not.toContainText(ERROR_TEXT);
          await expect
            .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), { timeout: 15_000 })
            .not.toBe(STALE_BRANCH);
          await expect(page.getByRole('main').or(page.locator('main')).first()).toBeVisible();
          await expect(page.locator('body')).not.toContainText(ERROR_TEXT);
        }
      });
    }
  }
});
