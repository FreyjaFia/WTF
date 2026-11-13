import { mkdirSync } from 'node:fs';
import { expect, test } from '@fixtures/index';
import { HeldOrdersShop } from '@api/held-orders';
import { OrderStatus } from '@data/enums';
import { ROUTES } from '@data/routes';
import { HeldOrdersPage } from '@pages/held-orders.page';
import { LoginPage } from '@pages/login.page';
import { today } from '@utils/dates';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/mnt/project-files/offline-phase-7/held-orders';

interface CloseRow {
  readonly section: string;
  readonly label: string;
  readonly orderCount: number;
  readonly amount: number;
}

// Three held orders in a shop of their own: Ana's old one (3 days, PHP 100), Ana's fresh one (PHP 100) and Ben's fresh one
// (2 x PHP 100). The shop's price is 120 now, so the real sync endpoint holds all three at the quoted 100.
async function seededShop(request: Parameters<typeof HeldOrdersShop.open>[0], platform: Parameters<typeof HeldOrdersShop.open>[1]) {
  const shop = await HeldOrdersShop.open(request, platform);
  const latte = await shop.product(120);
  const ana = await shop.cashier('Ana');
  const ben = await shop.cashier('Ben');
  const old = await shop.seedHeld(ana, latte, 100, { daysAgo: 3 });
  const fresh = await shop.seedHeld(ana, latte, 100);
  const double = await shop.seedHeld(ben, latte, 100, { quantity: 2 });
  return { shop, latte, ana, ben, old, fresh, double };
}

test.describe('held orders list and bulk approve @orders @offline @heldorders', () => {
  test('the banner links to the held orders list, which shows age, reasons, value and cashier', async ({ request, platform, newContext }) => {
    const { shop, old, fresh, double } = await seededShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(ROUTES.ordersList);

    const banner = page.locator('[data-held-orders]');
    await expect(banner).toBeVisible();
    await expect(banner.getByText('Aged')).toHaveCount(1);
    await banner.getByTestId('open-held-orders').click();
    await expect(page).toHaveURL(/\/orders\/held$/);

    const held = new HeldOrdersPage(page);
    await expect(held.heading).toBeVisible();
    await expect(held.summary).toContainText('3 waiting');
    await expect(held.summary).toContainText('PHP 400.00');
    await expect(held.agedTile).toContainText('1 waited over 2 days');

    await expect(held.row(old.orderNumber).getByTestId('aged-badge')).toContainText('Aged');
    await expect(held.row(old.orderNumber)).toContainText('Ana E2E');
    await expect(held.row(old.orderNumber)).toContainText('100.00');
    await expect(held.row(old.orderNumber)).toContainText('now costs 120.00, quoted 100.00');
    await expect(held.row(fresh.orderNumber).getByTestId('aged-badge')).toHaveCount(0);
    await expect(held.row(double.orderNumber)).toContainText('Ben E2E');
    await expect(held.row(double.orderNumber)).toContainText('200.00');
  });

  test('the filters drawer narrows the list by cashier and by aged only, and sorting reorders it', async ({ request, platform, newContext }) => {
    const { shop, old, fresh, double } = await seededShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    const held = new HeldOrdersPage(page);
    await held.open();

    await held.openFilters();
    await held.chooseCashier('Ben E2E');
    await held.closeFilters();
    await expect(held.row(double.orderNumber)).toBeVisible();
    await expect(held.row(old.orderNumber)).toHaveCount(0);
    await expect(held.row(fresh.orderNumber)).toHaveCount(0);

    await held.openFilters();
    await held.chooseCashier('Ana E2E');
    await page.getByTestId('filter-aged').check();
    await held.closeFilters();
    await expect(held.row(old.orderNumber)).toBeVisible();
    await expect(held.row(fresh.orderNumber)).toHaveCount(0);

    await held.open();
    await expect(held.row(double.orderNumber)).toBeVisible();
    await page.getByRole('button', { name: 'Value' }).click();
    await page.getByRole('button', { name: 'Value' }).click();
    const first = page.locator('[data-testid^="held-"][data-aged]').first();
    await expect(first).toHaveAttribute('data-testid', `held-${double.orderNumber}`);
  });

  test('Approve selected previews the count and total, then approves only the selected orders', async ({ request, platform, newContext }) => {
    const { shop, old, fresh, double } = await seededShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    const held = new HeldOrdersPage(page);
    await held.open();

    await held.select(old.orderNumber).check();
    await held.select(double.orderNumber).check();
    await expect(held.selectionBar).toContainText('2 selected');
    await expect(held.selectionBar).toContainText('PHP 300.00');

    await held.approveSelected.click();
    await expect(held.dialog).toBeVisible();
    await expect(held.dialogCount).toHaveText('2');
    await expect(held.dialogTotal).toContainText('300.00');
    // Nothing is approved before the confirm.
    expect(await shop.status(old.orderId)).toBe(OrderStatus.PendingReview);

    await held.confirm(2);
    await expect(held.dialog).toHaveCount(0);
    await expect(held.row(old.orderNumber)).toHaveCount(0);
    await expect(held.row(double.orderNumber)).toHaveCount(0);
    await expect(held.row(fresh.orderNumber)).toBeVisible();
    expect(await shop.status(old.orderId)).toBe(OrderStatus.Completed);
    expect(await shop.status(double.orderId)).toBe(OrderStatus.Completed);
    expect(await shop.status(fresh.orderId)).toBe(OrderStatus.PendingReview);
  });

  test('Approve all matching filters follows the filter, and cancelling the dialog approves nothing', async ({ request, platform, newContext }) => {
    const { shop, old, fresh, double } = await seededShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    const held = new HeldOrdersPage(page);
    await held.open();

    await held.openFilters();
    await held.chooseCashier('Ana E2E');
    await held.closeFilters();
    await held.approveMatching.click();
    await expect(held.dialogCount).toHaveText('2');
    await expect(held.dialogTotal).toContainText('200.00');
    await held.dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(held.dialog).toHaveCount(0);
    expect(await shop.status(old.orderId)).toBe(OrderStatus.PendingReview);

    await held.approveMatching.click();
    await held.confirm(2);
    await expect(held.dialog).toHaveCount(0);
    await expect.poll(() => shop.status(old.orderId)).toBe(OrderStatus.Completed);
    expect(await shop.status(fresh.orderId)).toBe(OrderStatus.Completed);
    expect(await shop.status(double.orderId)).toBe(OrderStatus.PendingReview);
  });

  test('the Daily Close shows the held sales next to the sales and they leave revenue out until approved', async ({ request, platform, newContext }) => {
    const { shop, latte, ana, fresh } = await seededShop(request, platform);
    await shop.owner.createOrder(latte.id, 1);
    const date = today();
    const close = async (): Promise<CloseRow[]> =>
      shop.owner.json<CloseRow[]>('GET', `reports/daily-close?fromDate=${date}&toDate=${date}`);
    const line = (rows: CloseRow[], label: string): CloseRow | undefined => rows.find((row) => row.label === label);

    const before = await close();
    // The aged order was sold three days ago, so only the two sold today are on today's line.
    expect(line(before, 'Offline sales held for review')).toMatchObject({ section: 'Sales', orderCount: 2, amount: 300 });
    expect(line(before, 'Net sales')).toMatchObject({ orderCount: 1, amount: 120 });

    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(ROUTES.report('daily-close'));
    await expect(page.getByText('Offline sales held for review').locator('visible=true').first()).toBeVisible();

    expect((await ana.session.call('POST', `orders/${fresh.orderId}/review/approve`)).status()).toBe(403);
    expect((await shop.owner.call('POST', `orders/${fresh.orderId}/review/approve`)).ok()).toBeTruthy();
    const after = await close();
    expect(line(after, 'Offline sales held for review')).toMatchObject({ orderCount: 1, amount: 200 });
    expect(line(after, 'Net sales')).toMatchObject({ orderCount: 2, amount: 220 });
  });

  test('the dashboard shows the held count and the aged sentence', async ({ request, platform, newContext }) => {
    const { shop } = await seededShop(request, platform);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(ROUTES.dashboard);

    const tile = page.locator('[data-dashboard-held]');
    await expect(tile).toContainText('3 offline, PHP 400.00');
    await expect(tile.locator('[data-dashboard-held-aged]')).toHaveText(
      '1 offline order has waited more than 2 days for review (PHP 100.00)',
    );
    await tile.click();
    await expect(page).toHaveURL(/\/orders\/held\?agedOnly=true/);
    await expect(new HeldOrdersPage(page).agedTile).toBeVisible();
  });

  test('cashiers and viewers cannot open the list or call the bulk endpoints', async ({ request, platform, newContext }) => {
    const { shop, ana, double } = await seededShop(request, platform);
    const viewer = await shop.viewer('Vic');

    for (const person of [ana, viewer]) {
      expect((await person.session.call('GET', 'orders/review')).status()).toBe(403);
      expect((await person.session.call('POST', 'orders/review/bulk-approve', { preview: true })).status()).toBe(403);
    }

    expect(await shop.status(double.orderId)).toBe(OrderStatus.PendingReview);
    const page = await (await newContext()).newPage();
    await new LoginPage(page).signIn(ana.username, ana.password);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(ROUTES.heldOrders);
    await expect(page).not.toHaveURL(/\/orders\/held/);
  });

  test('another shop never sees or approves these held orders', async ({ request, platform }) => {
    const { shop, old } = await seededShop(request, platform);
    const other = await HeldOrdersShop.open(request, platform);

    const listed = await other.owner.json<{ items: unknown[] }>('GET', 'orders/review');
    expect(listed.items).toHaveLength(0);
    const result = await other.owner.json<{ count: number; items: { outcome: string }[] }>('POST', 'orders/review/bulk-approve', {
      ids: [old.orderId],
      preview: false,
    });
    expect(result.count).toBe(0);
    expect(result.items[0].outcome).toBe('SkippedNotHeld');
    expect(await shop.status(old.orderId)).toBe(OrderStatus.PendingReview);
  });

  for (const viewport of VIEWPORTS) {
    test(`the list and the confirm dialog fit at ${viewport.name}`, async ({ request, platform, newContext }) => {
      const { shop, old, double } = await seededShop(request, platform);
      const page = await (await newContext({ width: viewport.width, height: viewport.height })).newPage();
      await new LoginPage(page).signIn(shop.shop.ownerUsername, shop.shop.ownerPassword);
      await page.waitForURL((url) => !url.pathname.startsWith('/login'));
      const held = new HeldOrdersPage(page);
      await held.open();
      await expect(held.row(old.orderNumber)).toBeVisible();
      await held.select(old.orderNumber).check();
      await held.select(double.orderNumber).check();
      await expect(held.selectionBar).toBeVisible();
      expect(overflowProblem(await measureOverflow(page))).toBeNull();

      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/list-${viewport.width}.png` });

      await held.approveSelected.click();
      await expect(held.dialogCount).toHaveText('2');
      const box = await held.dialog.getByRole('document').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: `${SHOTS}/confirm-${viewport.width}.png` });
    });
  }
});
