import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { SeniorPwdShop, ShopUser } from '@api/senior-pwd';
import { OrderDetailsPage } from '@pages/order-details.page';
import { LoginPage } from '@pages/login.page';
import { SeniorPwdPage } from '@pages/senior-pwd.page';

type NewContext = (options?: { width?: number; height?: number }) => Promise<import('@playwright/test').BrowserContext>;

async function signInTo(newContext: NewContext, user: ShopUser, width: number = 1440, height: number = 900): Promise<Page> {
  const page = await (await newContext({ width, height })).newPage();
  await new LoginPage(page).signIn(user.username, user.password);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

function ownerUser(shop: SeniorPwdShop): ShopUser {
  return { username: shop.shop.ownerUsername, password: shop.shop.ownerPassword };
}

test.describe('Senior / PWD discount at the register @seniorpwd @orders', () => {
  test('a shop that is not VAT-registered takes 20% off: 100.00 becomes 80.00', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(drink.name);
    await expect(register.cartTotal).toHaveText('100.00');

    await register.openDialog();
    await register.fillPerson(0, 'SC-1001', 'Lola Basyang');
    await expect(page.getByTestId('senior-pwd-total-discount')).toHaveText('-20.00');
    await expect(page.getByTestId('senior-pwd-total-due')).toHaveText('80.00');
    await expect(page.getByTestId('senior-pwd-total-vat')).toHaveCount(0);
    await register.apply.click();

    await expect(register.dialog).toHaveCount(0);
    await expect(register.visible('senior-pwd-row-discount')).toHaveText('-20.00');
    await expect(register.cartTotal).toHaveText('80.00');

    await page.getByRole('button', { name: 'Checkout', exact: true }).locator('visible=true').click();
    await page.locator('#amountReceived').fill('100');
    await page.getByRole('button', { name: 'Confirm & Pay' }).click();

    await expect
      .poll(async () => (await shop.owner.json<{ items: { id: string; totalAmount: number }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items[0]?.totalAmount)
      .toBe(80);
    const saved = (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items[0];
    const details = new OrderDetailsPage(page);
    await details.open(saved.id);
    await expect(page.getByTestId('senior-pwd-details-discount')).toHaveText('-20.00');
    await expect(page.getByTestId('senior-pwd-details-vat')).toHaveCount(0);
    await expect(page.getByTestId('senior-pwd-details')).toContainText('Lola Basyang');
  });

  test('a VAT-registered shop: 100.00 gives VAT exempt 10.71, discount 17.86 and 71.43 due', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: true });
    const drink = await shop.product(100);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(drink.name);
    await register.openDialog();
    await register.fillPerson(0, 'PWD-2002', 'Juan Dela Cruz');
    await page.getByTestId('senior-pwd-type-pwd-0').click();

    await expect(page.getByTestId('senior-pwd-total-vat')).toHaveText('10.71');
    await expect(page.getByTestId('senior-pwd-total-discount')).toHaveText('-17.86');
    await expect(page.getByTestId('senior-pwd-total-due')).toHaveText('71.43');
    await register.apply.click();

    await expect(register.visible('senior-pwd-row-vat')).toHaveText('10.71');
    await expect(register.cartTotal).toHaveText('71.43');
  });

  test('one of three lattes covered splits into a covered line and a normal line', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const latte = await shop.product(120);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(latte.name, 3);
    await expect(register.cartTotal).toHaveText('360.00');

    await register.openDialog();
    await register.fillPerson(0, 'SC-3003', 'Lola Nena');
    await expect(page.getByTestId('senior-pwd-qty-0-0')).toHaveText('3');
    await register.changeQuantity(0, 0, -2);
    await expect(page.getByTestId('senior-pwd-qty-0-0')).toHaveText('1');
    await expect(page.getByTestId('senior-pwd-total-discount')).toHaveText('-24.00');
    await register.apply.click();

    await expect(register.cartTotal).toHaveText('336.00');
    const badge = page.getByTestId('senior-pwd-line-badge').locator('visible=true');
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText('Senior/PWD x1');
    await expect(badge).toHaveAttribute('title', 'Lola Nena');
    await expect(page.getByTestId('senior-pwd-line-reduction').locator('visible=true')).toContainText('24.00');
  });

  test('the covered line of a saved order is tagged like a promotion in the order details', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const latte = await shop.product(120);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(latte.name, 3);
    await register.openDialog();
    await register.fillPerson(0, 'SC-4004', 'Lola Pilar');
    await register.changeQuantity(0, 0, -2);
    await register.apply.click();
    await expect(register.cartTotal).toHaveText('336.00');

    await page.getByRole('button', { name: 'Checkout', exact: true }).locator('visible=true').click();
    await page.locator('#amountReceived').fill('400');
    await page.getByRole('button', { name: 'Confirm & Pay' }).click();

    await expect
      .poll(async () => (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items.length)
      .toBe(1);
    const saved = (await shop.owner.json<{ items: { id: string }[] }>('GET', 'orders/paged?status=2&page=1&pageSize=20')).items[0];

    await new OrderDetailsPage(page).open(saved.id);
    const tag = page.getByTestId('senior-pwd-line-tag');
    await expect(tag).toHaveCount(1);
    await expect(tag).toContainText('Senior/PWD x1');
    await expect(page.getByTestId('senior-pwd-line-reduction')).toContainText('24.00');
  });

  test('a promotion item cannot be covered and says so', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const deal = await shop.product(100);
    await shop.promote(deal.id, 80);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(deal.name);
    await register.openDialog();

    await expect(page.getByTestId('senior-pwd-blocked-0')).toContainText('Promotion item, not eligible');
    await expect(page.getByTestId('senior-pwd-inc-0-0')).toHaveCount(0);
  });

  test('a product marked not food or drink is shown as not eligible', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const mug = await shop.product(250, 'Souvenir Mug');
    await shop.setEligible(mug.id, false);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(mug.name);
    await register.openDialog();

    await expect(page.getByTestId('senior-pwd-blocked-0')).toContainText('Not eligible');
  });

  test('two persons share one order', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const a = await shop.product(100);
    const b = await shop.product(75.5);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(a.name);
    await register.addProduct(b.name);
    await register.openDialog();

    await register.fillPerson(0, 'SC-4001', 'Person One');
    await register.changeQuantity(0, 1, -1);
    await register.addPerson.click();
    await register.fillPerson(1, 'PWD-4002', 'Person Two');
    await register.changeQuantity(1, 1, 1);
    await expect(page.getByTestId('senior-pwd-total-discount').first()).toHaveText('-20.00');
    await expect(page.getByTestId('senior-pwd-total-discount').nth(1)).toHaveText('-15.10');
    await register.apply.click();

    await expect(register.visible('senior-pwd-row-0')).toContainText('Person One');
    await expect(register.visible('senior-pwd-row-1')).toContainText('Person Two');
    await expect(register.cartTotal).toHaveText('140.40');
  });

  test('removing the discount restores the full total', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(drink.name);
    await register.openDialog();
    await register.fillPerson(0, 'SC-5005', 'Lolo Ben');
    await register.apply.click();
    await expect(register.cartTotal).toHaveText('80.00');

    await register.openDialog();
    await register.removeDiscount.click();
    await expect(register.dialog).toHaveCount(0);
    await expect(register.cartTotal).toHaveText('100.00');
    await expect(register.visible('senior-pwd-row-0')).toHaveCount(0);
  });

  test('a blank ID number or name stops Apply', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(drink.name);
    await register.openDialog();

    await register.apply.click();
    await expect(register.dialog).toBeVisible();
    await expect(register.dialog.getByRole('alert').first()).toBeVisible();
    await expect(register.cartTotal).toHaveText('100.00');
  });

  test('the button is hidden when the shop switch is off', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const drink = await shop.product(100);

    const page = await signInTo(newContext, ownerUser(shop));
    const register = new SeniorPwdPage(page);
    await register.open();
    await register.addProduct(drink.name);
    await register.openCart();

    await expect(register.cartTotal).toHaveText('100.00');
    await expect(page.getByTestId('senior-pwd-button')).toHaveCount(0);
  });

  test('the button is hidden for a role without the permission, and shown to a cashier', async ({ request, platform, newContext }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);
    const viewer = await shop.viewer();
    const cashier = await shop.cashier();

    const cashierPage = await signInTo(newContext, cashier);
    const cashierRegister = new SeniorPwdPage(cashierPage);
    await cashierRegister.open();
    await cashierRegister.addProduct(drink.name);
    await cashierRegister.openCart();
    await expect(cashierRegister.button).toBeVisible();

    const viewerSession = await shop.signInAs(viewer);
    const refused = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [{ type: 1, idNumber: 'SC-1', customerName: 'Nope' }], viewerSession);
    expect(refused.ok()).toBeFalsy();
  });

  test('the API refuses persons when the shop switch is off, and accepts them when it is on', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const drink = await shop.product(100);
    const person = { type: 1 as const, idNumber: 'SC-9009', customerName: 'Lola Remedios' };

    const refused = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [person]);
    expect(refused.ok()).toBeFalsy();

    await shop.setSwitches(true, false);
    const accepted = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [person]);
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    expect((await accepted.json()).totalAmount).toBe(80);
  });

  test('the API refuses a missing ID number', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: true, vatRegistered: false });
    const drink = await shop.product(100);

    const refused = await shop.placeOrderRaw([{ productId: drink.id, quantity: 1, personIndex: 0 }], [{ type: 1, idNumber: '  ', customerName: 'Someone' }]);
    expect(refused.ok()).toBeFalsy();
  });
});
