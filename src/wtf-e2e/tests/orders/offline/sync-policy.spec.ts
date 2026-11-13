import { mkdirSync } from 'node:fs';
import { APIRequestContext, Browser, Page } from '@playwright/test';
import { SeniorPwdShop } from '@api/senior-pwd';
import { ShopSession } from '@api/shop-session';
import { OrderStatus } from '@data/enums';
import { ROLE_IDS } from '@data/users';
import { expect, test } from '@fixtures/index';
import { LoginPage } from '@pages/login.page';
import { routeAppApiToTestApi } from '@utils/app-routing';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';
import { unique } from '@utils/unique';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/mnt/project-files/offline-phase-7/policy';
const POLICY_PATH = '/management/sync-policy';
const SOLD_AT = '2026-06-10T04:00:00Z';

interface SyncAnswer {
  readonly offlineLocalId: string;
  readonly orderId: string | null;
  readonly status: number | null;
  readonly error: string | null;
  readonly reasonDetails: ReadonlyArray<{ readonly code: string; readonly severity: 'Hold' | 'Note' }>;
}

interface PolicyBody {
  readonly codes: ReadonlyArray<{ readonly code: string; readonly mode: 'Hold' | 'Note' }>;
  readonly priceTolerance: number;
  readonly autoApproveNotes: boolean;
  readonly agedAfterDays: number;
  readonly updatedAt: string | null;
}

async function signInPage(browser: Browser, request: APIRequestContext, username: string, password: string, width = 1440, height = 900): Promise<Page> {
  const context = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width, height }, deviceScaleFactor: 1 });
  await routeAppApiToTestApi(context);
  const page = await context.newPage();
  await new LoginPage(page).signIn(username, password);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

async function syncOne(session: ShopSession, productId: string, quoted: number): Promise<SyncAnswer> {
  const localId = unique('POL');
  const results = await session.json<SyncAnswer[]>('POST', 'orders/sync', {
    orders: [
      {
        status: 2,
        items: [{ productId, quantity: 1, addOns: [], specialInstructions: null, bundlePromotionId: null, quotedPrice: quoted }],
        bundlePromotions: [],
        seniorPwdPersons: [],
        offlineLocalId: localId,
        createdAt: SOLD_AT,
        paymentMethod: 1,
        amountReceived: 1000,
      },
    ],
  });
  expect(results).toHaveLength(1);
  return results[0];
}

async function setPrice(owner: ShopSession, productId: string, price: number): Promise<void> {
  const product = await owner.json<Record<string, unknown>>('GET', `products/${productId}`);
  await owner.json<unknown>('PUT', `products/${productId}`, { ...product, price });
}

async function setActive(owner: ShopSession, productId: string, isActive: boolean): Promise<void> {
  const product = await owner.json<Record<string, unknown>>('GET', `products/${productId}`);
  await owner.json<unknown>('PUT', `products/${productId}`, { ...product, isActive });
}

test.describe('Offline sync policy @orders @offline @policy', () => {
  for (const viewport of VIEWPORTS) {
    test(`the Owner opens the policy screen at ${viewport.name}`, async ({ request, platform, browser }) => {
      const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
      const page = await signInPage(browser, request, shop.shop.ownerUsername, shop.shop.ownerPassword, viewport.width, viewport.height);

      await page.goto(POLICY_PATH);
      await expect(page.getByRole('heading', { name: 'Offline sync policy' })).toBeVisible();
      await expect(page.getByTestId('policy-row-PriceChanged')).toBeVisible();

      for (const code of ['PriceChanged', 'AddOnPriceChanged', 'ProductInactive', 'BundleChanged', 'CustomerInactive', 'PromotionEnded', 'UnknownProduct']) {
        await expect(page.getByTestId(`mode-${code}-Hold`)).toHaveAttribute('aria-checked', 'true');
      }

      await expect(page.getByTestId('policy-tolerance')).toHaveValue('0');
      await expect(page.getByTestId('policy-aged-days')).toHaveValue('2');
      await expect(page.getByTestId('policy-auto-approve')).not.toBeChecked();
      await expect(page.getByTestId('policy-fixed')).toContainText('Senior/PWD');
      await expect(page.getByTestId('policy-tolerance')).not.toHaveAttribute('placeholder', /./);

      const save = page.getByTestId('policy-save');
      await expect(save).toBeDisabled();
      await expect(save).toBeInViewport();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();

      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/policy-${viewport.width}.png` });

      await page.getByTestId('mode-CustomerInactive-Note').click();
      await page.getByTestId('policy-tolerance').fill('5');
      await expect(save).toBeEnabled();
      await expect(save).toBeInViewport();
      await save.click();
      await expect(save).toBeDisabled();

      await page.reload();
      await expect(page.getByTestId('mode-CustomerInactive-Note')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('policy-tolerance')).toHaveValue('5');
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      await page.screenshot({ path: `${SHOTS}/policy-saved-${viewport.width}.png` });

      await page.context().close();
    });
  }

  test('the Owner is asked before leaving with unsaved changes', async ({ request, platform, browser }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const page = await signInPage(browser, request, shop.shop.ownerUsername, shop.shop.ownerPassword);

    await page.goto(POLICY_PATH);
    await page.getByTestId('mode-PriceChanged-Note').click();
    await page.getByTestId('sync-policy-back').click();

    const dialog = page.locator('app-confirm-dialog').getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page).toHaveURL(new RegExp(`${POLICY_PATH}$`));

    await page.getByTestId('sync-policy-back').click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/management$/);
    await expect(page.getByTestId('management-card-sync-policy')).toBeVisible();

    await page.context().close();
  });

  test('an Admin has no entry for the policy and the API refuses Admin and Cashier', async ({ request, platform, browser }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const adminUser = await shop.user(ROLE_IDS.Admin);
    const cashierUser = await shop.cashier();
    const admin = await shop.signInAs(adminUser);
    const cashier = await shop.signInAs(cashierUser);

    const page = await signInPage(browser, request, adminUser.username, adminUser.password);
    await page.goto('/management');
    await expect(page.getByTestId('management-card-products')).toBeVisible();
    await expect(page.getByTestId('management-card-sync-policy')).toHaveCount(0);

    await page.goto(POLICY_PATH);
    await expect(page.getByRole('heading', { name: 'Offline sync policy' })).toHaveCount(0);
    await page.context().close();

    expect((await admin.call('GET', 'orders/sync-policy')).status()).toBe(403);
    expect((await cashier.call('GET', 'orders/sync-policy')).status()).toBe(403);
    const attempt: PolicyBody = { codes: [], priceTolerance: 900, autoApproveNotes: true, agedAfterDays: 5, updatedAt: null };
    expect((await admin.call('PUT', 'orders/sync-policy', attempt)).status()).toBe(403);
    expect((await cashier.call('PUT', 'orders/sync-policy', attempt)).status()).toBe(403);

    const policy = await shop.owner.json<PolicyBody>('GET', 'orders/sync-policy');
    expect(policy.priceTolerance).toBe(0);
    expect(policy.autoApproveNotes).toBe(false);
  });

  test('the API refuses a tolerance or days outside the allowed range and a code it cannot change', async ({ request, platform }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const body = (patch: Partial<PolicyBody> & { codes?: PolicyBody['codes'] | { code: string; mode: string }[] }) => ({
      codes: [],
      priceTolerance: 0,
      autoApproveNotes: false,
      agedAfterDays: 2,
      ...patch,
    });

    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ priceTolerance: 1001 }))).status()).toBe(400);
    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ priceTolerance: -1 }))).status()).toBe(400);
    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ agedAfterDays: 0 }))).status()).toBe(400);
    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ agedAfterDays: 31 }))).status()).toBe(400);
    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ codes: [{ code: 'SeniorPwdDisabled', mode: 'Note' }] }))).status()).toBe(400);
    expect((await shop.owner.call('PUT', 'orders/sync-policy', body({ priceTolerance: 1000, agedAfterDays: 30 }))).status()).toBe(200);
  });

  test('a tolerance set on the screen turns a held price difference into a note, end to end', async ({ request, platform, browser }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const near = await shop.product(153, unique('Near'));
    const far = await shop.product(156, unique('Far'));
    const cashier = await shop.signInAs(await shop.cashier());

    // With the default policy every difference is held, a 3 peso one too.
    const before = await syncOne(cashier, near.id, 150);
    expect(before.status).toBe(OrderStatus.PendingReview);
    expect(before.reasonDetails.map((r) => `${r.code}:${r.severity}`)).toEqual(['PriceChanged:Hold']);

    const page = await signInPage(browser, request, shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.goto(POLICY_PATH);
    await page.getByTestId('policy-tolerance').fill('5');
    await page.getByTestId('policy-save').click();
    await expect(page.getByTestId('policy-save')).toBeDisabled();
    await page.context().close();

    const saved = await shop.owner.json<PolicyBody>('GET', 'orders/sync-policy');
    expect(saved.priceTolerance).toBe(5);

    const within = await syncOne(cashier, near.id, 150);
    expect(within.status).toBe(OrderStatus.Completed);
    expect(within.reasonDetails.map((r) => `${r.code}:${r.severity}`)).toEqual(['PriceChanged:Note']);
    const order = await shop.owner.json<{ status: number; totalAmount: number }>('GET', `orders/${within.orderId}`);
    expect(order.status).toBe(OrderStatus.Completed);
    expect(order.totalAmount).toBe(150);

    const beyond = await syncOne(cashier, far.id, 150);
    expect(beyond.status).toBe(OrderStatus.PendingReview);
    expect(beyond.reasonDetails.map((r) => `${r.code}:${r.severity}`)).toEqual(['PriceChanged:Hold']);
  });

  test('a code set to Note on the screen no longer holds the sale, the other codes still do', async ({ request, platform, browser }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const switchedOff = await shop.product(100, unique('Off'));
    const repriced = await shop.product(100, unique('Repriced'));
    const cashier = await shop.signInAs(await shop.cashier());
    await setActive(shop.owner, switchedOff.id, false);
    await setPrice(shop.owner, repriced.id, 120);

    const page = await signInPage(browser, request, shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.goto(POLICY_PATH);
    await page.getByTestId('mode-ProductInactive-Note').click();
    await page.getByTestId('policy-auto-approve').check();
    await page.getByTestId('policy-save').click();
    await expect(page.getByTestId('policy-save')).toBeDisabled();
    await page.context().close();

    const off = await syncOne(cashier, switchedOff.id, 100);
    expect(off.status).toBe(OrderStatus.Completed);
    expect(off.reasonDetails.map((r) => `${r.code}:${r.severity}`)).toEqual(['ProductInactive:Note']);

    const price = await syncOne(cashier, repriced.id, 100);
    expect(price.status).toBe(OrderStatus.PendingReview);
  });

  test('the policy of one shop never applies to another', async ({ request, platform }) => {
    const first = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const second = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    await first.owner.json<unknown>('PUT', 'orders/sync-policy', { codes: [], priceTolerance: 50, autoApproveNotes: true, agedAfterDays: 9 });

    const other = await second.owner.json<PolicyBody>('GET', 'orders/sync-policy');
    expect(other.priceTolerance).toBe(0);
    expect(other.autoApproveNotes).toBe(false);
    expect(other.agedAfterDays).toBe(2);

    const drink = await second.product(153, unique('Iso'));
    const cashier = await second.signInAs(await second.cashier());
    expect((await syncOne(cashier, drink.id, 150)).status).toBe(OrderStatus.PendingReview);
  });

  test('the screen needs a connection: offline it says so and Save stays off', async ({ request, platform, browser }) => {
    const shop = await SeniorPwdShop.open(request, platform, { enabled: false, vatRegistered: false });
    const page = await signInPage(browser, request, shop.shop.ownerUsername, shop.shop.ownerPassword);

    await page.goto(POLICY_PATH);
    await expect(page.getByTestId('policy-row-PriceChanged')).toBeVisible();
    await page.getByTestId('mode-PriceChanged-Note').click();
    await expect(page.getByTestId('policy-save')).toBeEnabled();

    await page.context().setOffline(true);
    await expect(page.getByTestId('sync-policy-offline')).toBeVisible();
    await expect(page.getByTestId('policy-save')).toBeDisabled();

    await page.context().setOffline(false);
    await page.context().close();
  });
});
