import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { SeniorPwdShop } from '@api/senior-pwd';
import { OrderDetailsPage } from '@pages/order-details.page';
import { LoginPage } from '@pages/login.page';
import { SeniorPwdPage } from '@pages/senior-pwd.page';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/mnt/project-files/senior-pwd';

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
      await register.addProduct(drink.name, 3);
      await register.openDialog();
      await register.fillPerson(0, 'SC-LAYOUT-1', 'Maria Clara de los Santos y Alcantara');
      await register.changeQuantity(0, 0, -2);

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
      await expect(page.getByTestId('senior-pwd-cart-group-0').locator('visible=true')).toBeVisible();
      await page.getByTestId('senior-pwd-cart-group-0').locator('visible=true').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/cart-with-discount-${tag}.png` });
    });

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
