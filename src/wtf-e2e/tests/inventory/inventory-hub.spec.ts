import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';

test.describe('Inventory hub @inventory @layout', () => {
  test('the admin sees every card in two groups, with no tabs, and a card opens its screen', async ({ signIn }) => {
    const page = await signIn('admin');

    await go(page, '/inventory');
    const hub = page.getByTestId('inventory-hub');
    await expect(hub).toBeVisible();
    await expect(hub.locator('h2')).toHaveText(['Stock', 'Buying']);
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);

    await page.getByTestId('inventory-card-stock-in').click();
    await expect(page).toHaveURL(/\/inventory\/stock-in$/);
  });

  test('the Switch screen menu jumps between Inventory screens and marks where you are', async ({ signIn }) => {
    const page = await signIn('admin');

    await go(page, '/inventory/items');
    await page.getByTestId('inventory-switcher-button').click();
    const panel = page.getByTestId('inventory-switcher-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('inventory-switcher-item-items')).toHaveAttribute('aria-current', 'page');
    await expect(panel.getByRole('link')).toHaveCount(9);

    await page.getByTestId('inventory-switcher-item-receiving').click();
    await expect(page).toHaveURL(/\/inventory\/receiving$/);
    await expect(panel).toBeHidden();

    await page.getByTestId('inventory-switcher-button').click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    await page.getByTestId('inventory-switcher-button').click();
    await page.getByTestId('inventory-switcher-hub').click();
    await expect(page).toHaveURL(/\/inventory$/);
  });

  test('an item manager sees only the item cards', async ({ signIn }) => {
    const page = await signIn('itemmgr');

    await go(page, '/inventory');
    await expect(page.getByTestId('inventory-card-items')).toBeVisible();
    await expect(page.getByTestId('inventory-card-purchase-orders')).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`the hub and the way back work at ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('admin');
      const watcher = watch(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await go(page, '/inventory');
      await expect(page.getByTestId('inventory-card-items')).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: hub overflow`).toBeNull();
      await page.screenshot({ path: `/mnt/project-files/rbac-phase-4/inventory-hub-${viewport.name}.png` });

      await page.getByTestId('inventory-card-items').click();
      await expect(page).toHaveURL(/\/inventory\/items$/);
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: items overflow`).toBeNull();

      await page.getByTestId('inventory-switcher-button').click();
      const panel = page.getByTestId('inventory-switcher-panel');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect.soft(box && box.x >= 0 && box.x + box.width <= viewport.width, `${viewport.name}: switcher inside the screen`).toBe(true);
      expect.soft(box && box.y >= 0 && box.y + box.height <= viewport.height, `${viewport.name}: switcher fits the height`).toBe(true);
      await page.screenshot({ path: `/mnt/project-files/rbac-phase-4/switcher-inventory-${viewport.name.replace(' ', '-')}.png` });
      await page.keyboard.press('Escape');

      const back = page.getByTestId('inventory-back');
      if (viewport.width < 640) {
        await expect(back).toBeVisible();
        await back.click();
        await expect(page).toHaveURL(/\/inventory$/);
      } else {
        await expect(back).toBeHidden();
      }

      expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
      expect.soft(watcher.consoleErrors, `${viewport.name}: console errors`).toEqual([]);
    });
  }
});
