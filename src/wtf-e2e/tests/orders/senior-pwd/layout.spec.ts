import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { SeniorPwdShop } from '@api/senior-pwd';
import { OrderDetailsPage } from '@pages/order-details.page';
import { LoginPage } from '@pages/login.page';
import { SeniorPwdPage } from '@pages/senior-pwd.page';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/mnt/project-files/senior-pwd/v3';

test.describe('Senior / PWD layout @seniorpwd @layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`the cart and the dialog fit at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: true });
      const drink = await shop.product(100, 'Layout Latte With A Rather Long Name');

      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const register = new SeniorPwdPage(page);
      await register.open();
      await register.addProduct(drink.name, 5);
      await register.openDialog();
      await register.fillPerson(0, 'SC-LAYOUT-1', 'Maria Clara de los Santos y Alcantara');
      await register.changeQuantity(0, 0, -3);

      const box = await register.dialog.getByRole('document').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width < 640) {
        expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
      } else {
        expect(box!.y).toBeGreaterThan(0);
      }

      await expect(register.apply).toBeInViewport();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      const tag = String(viewport.width);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/dialog-${tag}.png` });

      await register.apply.click();
      await expect(register.dialog).toHaveCount(0);
      await expect(register.section).toBeVisible();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      const badge = page.getByTestId('senior-pwd-line-badge').locator('visible=true');
      await expect(badge).toBeVisible();
      await badge.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/cart-senior-${tag}.png` });
    });

    test(`a promotion line looks the same way in the cart at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
      const drink = await shop.product(120, 'Deal Latte');
      await shop.promote(drink.id, 30);

      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const register = new SeniorPwdPage(page);
      await register.open();
      await register.addProduct(drink.name, 5);

      await register.openCart();
      await expect(register.cartTotal).toHaveText('450.00');
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/cart-promo-${viewport.width}.png` });
    });

    for (const kind of ['senior', 'promo'] as const) {
      test(`the downloadable summary of a ${kind} order fits at ${viewport.name}`, async ({ request, platform, newContext }) => {
        const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
        const drink = await shop.product(120, kind === 'senior' ? 'Summary Latte' : 'Deal Latte');
        if (kind === 'promo') {
          await shop.promote(drink.id, 30);
        }

        const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
        await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
        await page.waitForURL((url) => !url.pathname.startsWith('/login'));
        const register = new SeniorPwdPage(page);
        await register.open();
        await register.addProduct(drink.name, 5);
        if (kind === 'senior') {
          await register.openDialog();
          await register.fillPerson(0, 'SC-SUMMARY-1', 'Lola Nena');
          await register.changeQuantity(0, 0, -3);
          await register.apply.click();
        }

        if (kind === 'promo') {
          await register.openCart();
        }

        await page.getByRole('button', { name: 'Checkout', exact: true }).locator('visible=true').click();
        await page.locator('#amountReceived').fill('1000');
        await page.getByRole('button', { name: 'Confirm & Pay' }).click();
        await expect
          .poll(async () => (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items.length)
          .toBe(1);
        const saved = (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items[0];
        await new OrderDetailsPage(page).open(saved.id);

        const host = page.locator('app-order-receipt').first();
        const receipt = host.locator('> div').first();
        await expect(receipt).toContainText(drink.name);
        if (kind === 'senior') {
          await expect(receipt.getByTestId('receipt-senior-pwd-line-tag')).toContainText('Senior/PWD x2');
          await expect(receipt.getByTestId('receipt-senior-pwd-line-reduction')).toContainText('48.00');
        }

        // The summary is drawn off-screen for the download; bring it on-screen to photograph it.
        await receipt.evaluate((el) => {
          el.style.left = '0';
          el.style.zIndex = '9999';
          el.style.background = 'white';
        });
        mkdirSync(SHOTS, { recursive: true });
        await receipt.screenshot({ path: `${SHOTS}/summary-${kind}-${viewport.width}.png` });
      });
    }

    test(`the covered line in the order details fits at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
      const drink = await shop.product(120, 'Details Latte');

      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const register = new SeniorPwdPage(page);
      await register.open();
      await register.addProduct(drink.name, 3);
      await register.openDialog();
      await register.fillPerson(0, 'SC-LAYOUT-2', 'Lola Nena');
      await register.changeQuantity(0, 0, -2);
      await register.apply.click();
      await page.getByRole('button', { name: 'Checkout', exact: true }).locator('visible=true').click();
      await page.locator('#amountReceived').fill('400');
      await page.getByRole('button', { name: 'Confirm & Pay' }).click();

      await expect
        .poll(async () => (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items.length)
        .toBe(1);
      const saved = (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items[0];
      await new OrderDetailsPage(page).open(saved.id);

      const tag = page.getByTestId('senior-pwd-line-tag');
      await expect(tag).toBeVisible();
      await tag.scrollIntoViewIfNeeded();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/details-${viewport.width}.png` });
    });
  }
});
