import { mkdirSync } from 'node:fs';
import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { KitchenPage } from '@pages/kitchen.page';
import { VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/branch-dropdown-and-kitchen-cards';

async function everyOptionIsFullyVisible(page: Page, width: number, height: number): Promise<void> {
  const menu = page.locator('[data-testid="branch-switcher-menu"]:visible');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('opacity', '1');
  const options = menu.locator('[data-testid^="branch-option-"]');
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(3);

  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const box = (await option.boundingBox())!;
    expect(box.x, 'option starts on screen').toBeGreaterThanOrEqual(0);
    expect(box.y, 'option starts on screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'option ends on screen').toBeLessThanOrEqual(width);
    expect(box.y + box.height, 'option ends on screen').toBeLessThanOrEqual(height);

    // Nothing (the profile picture, the sidebar) may sit on top of the option: the topmost thing at its centre is the option.
    const covered = await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return !top || !element.contains(top);
    });
    expect(covered, `option ${i} is covered by something`).toBe(false);
  }
}

test.describe('the branch dropdown and kitchen cards @layout @branches @kitchen', () => {
  test('the branch dropdown opens fully visible and uncovered, with the sidebar open or collapsed', async ({ api, signIn }) => {
    const first = await api.branches.create(unique('B').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4));
    const second = await api.branches.create(unique('Q').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4));
    try {
      const page = await signIn('owner');
      mkdirSync(SHOTS, { recursive: true });

      for (const viewport of VIEWPORTS) {
        for (const collapsed of viewport.width >= 640 ? [true, false] : [false]) {
          await test.step(`${viewport.name}${viewport.width >= 640 ? (collapsed ? ' sidebar collapsed' : ' sidebar open') : ''}`, async () => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.goto('/management/products');
            await page.waitForLoadState('load');
            if (viewport.width >= 640) {
              const aside = page.locator('aside.app-sidebar');
              const isCollapsed = (await aside.getAttribute('class'))?.includes('sidebar-collapsed') ?? false;
              if (isCollapsed !== collapsed) {
                await page.getByRole('button', { name: collapsed ? 'Collapse sidebar' : 'Expand sidebar' }).click();
              }
            }

            await page.locator('[data-testid="branch-switcher-button"]:visible').click();
            await everyOptionIsFullyVisible(page, viewport.width, viewport.height);
            await page.screenshot({ path: `${SHOTS}/branch-dropdown-${viewport.width}${collapsed ? '-collapsed' : '-open'}.png` });
            await page.keyboard.press('Escape');
            await page.locator('body').click({ position: { x: viewport.width - 5, y: viewport.height - 5 } });
          });
        }
      }
    } finally {
      await api.branches.closeQuietly(first.id);
      await api.branches.closeQuietly(second.id);
    }
  });

  test('a long order does not stretch the short card next to it on Served today', async ({ api, signIn }) => {
    const drink = await api.products.create({ price: 120 });
    const short = await api.orders.create({ items: [{ productId: drink.id, quantity: 1 }] });
    const long = await api.orders.create({
      items: Array.from({ length: 11 }, () => ({ productId: drink.id, quantity: 1 })),
    });

    const page = await signIn('kitchen');
    const kitchen = new KitchenPage(page);
    await kitchen.open();
    for (const order of [short, long]) {
      for (let step = 0; step < 3; step++) {
        await kitchen.advance(order.orderNumber);
      }
    }

    mkdirSync(SHOTS, { recursive: true });
    for (const viewport of VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await kitchen.open();
        await kitchen.servedTab.click();
        const shortBox = (await kitchen.card(short.orderNumber).boundingBox())!;
        const longBox = (await kitchen.card(long.orderNumber).boundingBox())!;
        expect(longBox.height, 'the long order is taller').toBeGreaterThan(shortBox.height * 2);
        expect(shortBox.height, 'the short card keeps the height of its own content').toBeLessThan(260);
        await page.screenshot({ path: `${SHOTS}/kitchen-served-${viewport.width}.png` });
      });
    }
  });
});
