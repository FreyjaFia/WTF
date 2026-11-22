import { mkdirSync } from 'node:fs';
import { Page } from '@playwright/test';
import { World, closeWorld, openWorld } from '@api/branch-scope';
import { ROUTES } from '@data/routes';
import { expect, test } from '@fixtures/index';
import { BranchSwitcherPage } from '@pages/branch-switcher.page';
import { KitchenPage } from '@pages/kitchen.page';
import { openAs } from '@utils/branch-ui';
import { VIEWPORTS, measureOverflow, overflowProblem, watch } from '@utils/layout';
import { go } from '@utils/navigation';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/branch-viewports';

async function expectMenuInsideScreen(page: Page, switcher: BranchSwitcherPage, width: number, height: number): Promise<void> {
  const count = await switcher.options.count();
  expect(count, 'all branches, branch A and branch C').toBe(3);

  for (let index = 0; index < count; index++) {
    const option = switcher.options.nth(index);
    const box = (await option.boundingBox())!;
    expect(box.x, `option ${index} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.y, `option ${index} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `option ${index} ends on screen`).toBeLessThanOrEqual(width);
    expect(box.y + box.height, `option ${index} ends on screen`).toBeLessThanOrEqual(height);

    const covered = await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return !top || !element.contains(top);
    });
    expect(covered, `option ${index} is covered by something`).toBe(false);
  }

  expect.soft(overflowProblem(await measureOverflow(page)), 'overflow with the dropdown open').toBeNull();
}

test.describe('the branch dropdown and the kitchen board at every width @branches @layout', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
    const longDrink = await api.products.create({ name: unique('Iced Spanish Latte With Extra Shot And Oat Milk'), price: 215 });
    await world.scope.placeOrder(world.branchA.id, longDrink, 3);
    await world.scope.placeOrder(world.branchA.id, world.drinkA, 2);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  for (const viewport of VIEWPORTS) {
    test(`a limited manager at ${viewport.name}: the dropdown is fully visible and the kitchen board does not scroll sideways`, async ({
      api,
      newContext,
    }) => {
      const shop = world!;
      mkdirSync(SHOTS, { recursive: true });
      const page = await openAs(api, newContext, shop.manager, { width: viewport.width, height: viewport.height });
      const watcher = watch(page);
      const switcher = new BranchSwitcherPage(page);

      await go(page, ROUTES.ordersList);
      await expect(page.getByTestId('order-row')).toHaveCount(3);
      await expect(switcher.button).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: orders list overflow`).toBeNull();

      await switcher.open();
      await expectMenuInsideScreen(page, switcher, viewport.width, viewport.height);
      expect(await switcher.codes()).toHaveLength(3);
      await page.screenshot({ path: `${SHOTS}/dropdown-${viewport.width}.png` });
      await switcher.close();

      const kitchen = new KitchenPage(page);
      await kitchen.open();
      await expect(page.getByText(shop.drinkA.name).first()).toBeVisible();
      await expect(page.getByTestId('kitchen-branch-label')).toContainText(shop.branchA.name);
      await expect(page.getByText(shop.drinkB.name)).toHaveCount(0);
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: kitchen board overflow`).toBeNull();
      await page.screenshot({ path: `${SHOTS}/kitchen-${viewport.width}.png` });

      await switcher.open();
      await expectMenuInsideScreen(page, switcher, viewport.width, viewport.height);
      await page.screenshot({ path: `${SHOTS}/kitchen-dropdown-${viewport.width}.png` });

      expect.soft(watcher.pageErrors, `${viewport.name}: page errors`).toEqual([]);
    });

    test(`a limited cashier at ${viewport.name}: the dropdown lists only their branch and the kitchen board fits`, async ({
      api,
      newContext,
    }) => {
      const shop = world!;
      mkdirSync(SHOTS, { recursive: true });
      const page = await openAs(api, newContext, shop.cashier, { width: viewport.width, height: viewport.height });
      const switcher = new BranchSwitcherPage(page);

      const kitchen = new KitchenPage(page);
      await kitchen.open();
      await expect(switcher.button).toBeVisible();
      await expect(page.getByText(shop.drinkA.name).first()).toBeVisible();
      expect.soft(overflowProblem(await measureOverflow(page)), `${viewport.name}: kitchen board overflow`).toBeNull();

      await switcher.open();
      expect(await switcher.codes()).toEqual([shop.branchA.code]);
      const box = (await switcher.options.first().boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `${SHOTS}/cashier-kitchen-${viewport.width}.png` });
    });
  }
});
