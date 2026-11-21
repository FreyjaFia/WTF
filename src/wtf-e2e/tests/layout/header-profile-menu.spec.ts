import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_VISUAL_SHOTS_DIR ?? 'test-results/header-profile-menu';

test.describe('the header, the profile menu and the branch code @layout @branches', () => {
  test('the bar keeps its items apart, the branch shows its code, and the profile menu holds the style choice at every width', async ({ api, signIn }) => {
    const branch = await api.branches.create(unique('H').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4), 'Greenhills Flagship Branch');
    try {
      const page = await signIn('owner');
      mkdirSync(SHOTS, { recursive: true });

      for (const viewport of VIEWPORTS) {
        await test.step(viewport.name, async () => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(ROUTES.ordersList);
          const phone = viewport.width < 640;
          const bar = page.locator(phone ? '.navbar' : 'aside.app-sidebar');
          const avatar = bar.locator('.avatar').first();
          await expect(avatar).toBeVisible();

          await expect(page.locator('app-theme-switcher:visible')).toHaveCount(0);
          const switcher = page.locator('[data-testid="branch-switcher-button"]:visible').first();
          const main = await api.branches.main();
          if (phone || viewport.width >= 1024) {
            await expect(switcher).toHaveText(main.code);
            await expect(switcher).not.toContainText(main.name);
          }

          if (phone) {
            const boxes = await bar.locator(':scope > .shrink-0 > *:visible').evaluateAll((els) =>
              els.map((el) => {
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, width: r.width };
              }).filter((r) => r.width > 0),
            );
            for (let i = 1; i < boxes.length; i++) {
              expect(boxes[i].left, `header item ${i} overlaps the one before`).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5);
            }
            expect(boxes[boxes.length - 1].right, 'the bar fits the screen').toBeLessThanOrEqual(viewport.width);
            await page.screenshot({ path: `${SHOTS}/header-${viewport.width}.png`, clip: { x: 0, y: 0, width: viewport.width, height: 80 } });
          }

          await avatar.click();
          const menu = page.locator('[data-testid="menu-styles"]:visible');
          await expect(menu).toBeVisible();
          await expect(page.locator('[data-testid="menu-version"]:visible')).toBeVisible();
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${SHOTS}/profile-menu-${viewport.width}.png` });

          await page.locator('[data-testid="menu-style-cafe"]:visible').click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'cafe');
          await page.locator('[data-testid="menu-style-light"]:visible').click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        });
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(ROUTES.ordersList);
      await page.locator('[data-testid="branch-switcher-button"]:visible').first().click();
      await expect(page.locator('[data-testid="branch-switcher-menu"]:visible')).toContainText('Greenhills Flagship Branch');
      await page.screenshot({ path: `${SHOTS}/branch-open-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 320 } });
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });

  test('switching from one branch to All branches shows no branch code on the list until the reload has loaded the All data', async ({ api, signIn }) => {
    const branch = await api.branches.create(unique('F').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4));
    try {
      const product = await api.products.create();
      const body = api.orders.body({ items: [{ productId: product.id, quantity: 1 }] });
      const created = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': branch.id } });
      expect(created.ok(), await created.text()).toBeTruthy();

      const page = await signIn('owner');
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(ROUTES.ordersList);
      await page.locator('[data-testid="branch-switcher-button"]:visible').click();
      await page.locator(`[data-testid="branch-option-${branch.code}"]:visible`).click();
      await page.waitForLoadState('load');
      await expect(page.getByTestId('order-row').first()).toBeVisible();

      await page.evaluate(() => {
        sessionStorage.removeItem('badge-flash');
        const seen = (): boolean => document.querySelector('[data-testid="order-branch"]') !== null;
        let flashed = seen();
        new MutationObserver(() => {
          flashed = flashed || seen();
        }).observe(document.body, { childList: true, subtree: true });
        window.addEventListener('pagehide', () => sessionStorage.setItem('badge-flash', String(flashed)));
      });

      await page.locator('[data-testid="branch-switcher-button"]:visible').click();
      await page.locator('[data-testid="branch-option-all"]:visible').click();
      await page.waitForLoadState('load');
      await expect(page.getByTestId('order-branch').locator('visible=true').first()).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem('badge-flash'))).toBe('false');
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });
});
