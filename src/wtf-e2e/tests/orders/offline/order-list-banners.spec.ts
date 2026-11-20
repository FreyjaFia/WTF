import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { Api } from '@api/index';
import { OrderStatus, PaymentMethod } from '@data/enums';
import { HeldOrdersShop } from '@api/held-orders';
import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { HeldOrdersPage } from '@pages/held-orders.page';
import { LoginPage } from '@pages/login.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_BANNER_SHOTS_DIR ?? 'test-results/order-list-banners';

async function failingSale(api: Api): Promise<void> {
  const response = await api.client.call('cashier', 'POST', 'orders/sync', {
    body: {
      orders: [
        {
          status: OrderStatus.Completed,
          items: [{ productId: randomUUID(), quantity: 2, addOns: [], quotedPrice: 50 }],
          offlineLocalId: unique('OFF'),
          createdAt: new Date().toISOString(),
          paymentMethod: PaymentMethod.Cash,
          amountReceived: 150,
          expectedTotal: 100,
        },
      ],
    },
  });
  await response.json();
}

test.describe('order list banners and offline pages @orders @offline @layout', () => {
  test('the unsynced banner is compact and sentence case, and its page uses the standard pagination bar', async ({ api, signIn }) => {
    await failingSale(api);
    const page = await signIn('admin');
    mkdirSync(SHOTS, { recursive: true });

    for (const viewport of VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(ROUTES.ordersList);
        const banner = page.locator('[data-unsynced-banner]');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('Unsynced order');
        expect((await banner.boundingBox())!.height).toBeLessThan(56);
        const avatar = page.locator('.navbar .avatar');
        if (await avatar.isVisible()) {
          const box = (await avatar.boundingBox())!;
          expect(box.x + box.width, 'the profile picture stays on screen').toBeLessThanOrEqual(viewport.width);
        }
        await page.screenshot({ path: `${SHOTS}/orders-${viewport.width}.png` });

        await banner.click();
        await expect(page.getByTestId('pagination')).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
        await page.screenshot({ path: `${SHOTS}/unsynced-${viewport.width}.png` });
      });
    }
  });

  test('held orders page has a back arrow and the standard pagination bar', async ({ request, platform, newContext }) => {
    const shop = await HeldOrdersShop.open(request, platform);
    const latte = await shop.product(120);
    const ana = await shop.cashier('Ana');
    await shop.seedHeld(ana, latte, 100);
    await shop.seedHeld(ana, latte, 100, { quantity: 2 });
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    mkdirSync(SHOTS, { recursive: true });

    for (const viewport of VIEWPORTS) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(ROUTES.ordersList);
        const banner = page.locator('[data-held-orders]');
        await expect(banner).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/orders-held-${viewport.width}.png` });

        await banner.getByTestId('open-held-orders').click();
        const held = new HeldOrdersPage(page);
        await expect(held.heading).toBeVisible();
        await expect(page.getByTestId('pagination')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to orders' })).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
        await page.screenshot({ path: `${SHOTS}/held-${viewport.width}.png` });
        await page.getByRole('button', { name: 'Back to orders' }).click();
        await expect(page).toHaveURL(/\/orders\/list$/);
      });
    }
  });

  test('the branch chip sits apart from the order number, only shows for All branches, and the profile picture stays reachable', async ({ api, signIn }) => {
    const branch = await api.branches.create(unique('C').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4));
    try {
      const product = await api.products.create();
      const body = api.orders.body({ items: [{ productId: product.id, quantity: 1 }] });
      const created = await api.client.call('owner', 'POST', 'orders', { body, headers: { 'X-Branch-Id': branch.id } });
      expect(created.ok(), await created.text()).toBeTruthy();

      const page = await signIn('owner');
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(ROUTES.ordersList);
      const avatar = page.locator('.navbar .avatar');
      await expect(avatar).toBeVisible();
      const box = (await avatar.boundingBox())!;
      expect(box.x + box.width, 'the profile picture stays on screen').toBeLessThanOrEqual(375);

      await page.locator('[data-testid="branch-switcher-button"]:visible').click();
      await page.locator('[data-testid="branch-option-all"]:visible').click();
      await page.waitForLoadState('load');
      const chip = page.getByTestId('order-branch').locator('visible=true').first();
      await expect(chip).toBeVisible();
      const number = chip.locator('xpath=preceding-sibling::span[1]');
      const gap = (await chip.boundingBox())!.x - (await number.boundingBox())!.x - (await number.boundingBox())!.width;
      expect(gap, 'space between the order number and the branch code').toBeGreaterThanOrEqual(6);
      await page.screenshot({ path: `${SHOTS}/branch-all-375.png` });

      await page.locator('[data-testid="branch-switcher-button"]:visible').click();
      await page.locator(`[data-testid="branch-option-${branch.code}"]:visible`).click();
      await page.waitForLoadState('load');
      await expect(page.getByTestId('order-row').first()).toBeVisible();
      await expect(page.getByTestId('order-branch')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/branch-one-375.png` });
    } finally {
      await api.branches.closeQuietly(branch.id);
    }
  });
});
