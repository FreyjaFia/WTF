import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';

test.describe('Management hub @management @layout', () => {
  test('the owner sees every card in five groups, and a card opens its screen', async ({ signIn }) => {
    const page = await signIn('owner');

    await go(page, '/management');
    const hub = page.getByTestId('management-hub');
    await expect(hub).toBeVisible();
    await expect(hub.locator('h2')).toHaveText(['Sell', 'Money', 'People', 'Settings', 'System']);
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);

    await page.getByTestId('management-card-roles').click();
    await expect(page).toHaveURL(/\/management\/roles$/);
  });

  test('the Switch screen menu lists only the screens the role may open', async ({ signIn }) => {
    const page = await signIn('admin');

    await go(page, '/management/products');
    await page.getByTestId('management-switcher-button').click();
    await expect(page.getByTestId('management-switcher-item-products')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('management-switcher-item-audit-logs')).toHaveCount(0);

    await page.getByTestId('management-switcher-item-customers').click();
    await expect(page).toHaveURL(/\/management\/customers$/);
    await expect(page.getByTestId('management-switcher-panel')).toBeHidden();
  });

  test('a stock manager has nothing to switch between, so no menu', async ({ signIn }) => {
    const page = await signIn('stockmgr');

    await go(page, '/management/setup');
    await expect(page.getByTestId('management-switcher-button')).toHaveCount(0);
  });

  test('a stock manager sees only the Setup card', async ({ signIn }) => {
    const page = await signIn('stockmgr');

    await go(page, '/management');
    await expect(page.locator('[data-testid^="management-card-"]')).toHaveCount(1);
    await expect(page.getByTestId('management-card-setup')).toBeVisible();
  });

  test('an admin does not get the owner-only cards', async ({ signIn }) => {
    const page = await signIn('admin');

    await go(page, '/management');
    await expect(page.getByTestId('management-card-products')).toBeVisible();
    await expect(page.getByTestId('management-card-audit-logs')).toHaveCount(0);
    await expect(page.getByTestId('management-card-schema-scripts')).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`the hub and the way back work at ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('owner');
      const watcher = watch(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await go(page, '/management');
      await expect(page.getByTestId('management-card-products')).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: hub overflow`).toBeNull();

      await page.getByTestId('management-card-products').click();
      await expect(page).toHaveURL(/\/management\/products$/);
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: products overflow`).toBeNull();

      await page.getByTestId('management-switcher-button').click();
      const panel = page.getByTestId('management-switcher-panel');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect.soft(box && box.x >= 0 && box.x + box.width <= viewport.width, `${viewport.name}: switcher inside the screen`).toBe(true);
      expect.soft(box && box.y >= 0 && box.y + box.height <= viewport.height, `${viewport.name}: switcher fits the height`).toBe(true);
      await page.screenshot({ path: `/mnt/project-files/rbac-phase-4/switcher-management-${viewport.name.replace(' ', '-')}.png` });
      await page.keyboard.press('Escape');

      const back = page.getByTestId('management-back');
      if (viewport.width < 640) {
        await expect(back).toBeVisible();
        await back.click();
        await expect(page).toHaveURL(/\/management$/);
      } else {
        await expect(back).toBeHidden();
      }

      expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
      expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
    });
  }
});
