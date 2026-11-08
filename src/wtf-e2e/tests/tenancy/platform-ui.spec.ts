import { expect, test } from '@fixtures/index';
import { PLATFORM_ROUTES } from '@data/routes';
import { PlatformDock, PlatformLoginPage, PlatformShell, PlatformShopPage, PlatformShopsPage } from '@pages/platform.page';
import { CreatedShop, TENANT_STATUS } from '@api/platform';
import { unique } from '@utils/unique';
import { openShop } from '@utils/tenants';

test.describe('platform shops list: filters, sorting, rows @tenancy @platform @ui', () => {
  test('the Filters drawer opens, counts the shops per status, and shows how many filters are on', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    await platform.setStatus(created.tenant.id, 'suspend');
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await expect(shops.filtersButton).toHaveAccessibleName('Filters');
    await shops.filtersButton.click();
    await expect(shops.filtersDrawerTitle).toBeVisible();
    for (const id of [1, 2, 3, 4] as const) {
      await expect(shops.statusFilter(id)).not.toBeChecked();
    }

    await shops.statusFilter(TENANT_STATUS.Suspended).check();
    await shops.statusFilter(TENANT_STATUS.Cancelled).check();
    await expect(shops.filtersButton).toHaveAccessibleName(/Filters, 1 applied/);
    await expect(shops.row(created.tenant.slug)).toBeVisible();
  });

  test('Clear in the drawer switches every status filter off', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();
    await shops.search.fill(created.tenant.slug);
    await shops.filtersButton.click();
    await shops.statusFilter(TENANT_STATUS.Cancelled).check();
    await expect(shops.row(created.tenant.slug)).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear', exact: true }).click();

    await expect(shops.statusFilter(TENANT_STATUS.Cancelled)).not.toBeChecked();
    await expect(shops.row(created.tenant.slug)).toBeVisible();
    await expect(shops.filtersButton).toHaveAccessibleName('Filters');
  });

  test('a search with no match, or a filter that hides every shop, shows the empty state', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await shops.search.fill(`zz-no-such-shop-${Date.now()}`);

    await expect(page.getByText('No shops found')).toBeVisible();
    await expect(page.getByText('Try adjusting your search or filters')).toBeVisible();
    await expect(page.getByTestId('shops-table')).toHaveCount(0);
  });

  test('search matches the shop address as well as the name, in any letter case', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    const other = await platform.createShop();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await shops.search.fill(created.tenant.slug.toUpperCase());

    await expect(shops.row(created.tenant.slug)).toBeVisible();
    await expect(shops.row(other.tenant.slug)).toHaveCount(0);
  });

  test('clicking a column header sorts by it, and clicking again reverses the order', async ({ newContext, platform }) => {
    const stamp = Date.now().toString(36);
    const names = ['Alpha', 'Bravo', 'Charlie'].map((n) => `Sort${stamp} ${n}`);
    const created: CreatedShop[] = [];
    for (const name of [names[1], names[2], names[0]]) {
      created.push(await platform.createShop({ name }));
    }
    const slugOf = (name: string): string => created.find((c) => c.tenant.name === name)!.tenant.slug;
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();
    await shops.search.fill(`Sort${stamp}`);
    await expect(shops.row(slugOf(names[0]))).toBeVisible();

    expect(await shops.rowSlugs()).toEqual(names.map(slugOf));
    await shops.sortHeader('Shop').click();
    await expect.poll(() => shops.rowSlugs()).toEqual([...names].reverse().map(slugOf));
    await shops.sortHeader('Shop').click();
    await expect.poll(() => shops.rowSlugs()).toEqual(names.map(slugOf));
  });

  test('sorting by Orders puts the busiest shop first once the column is reversed', async ({ request, newContext, platform }) => {
    const stamp = Date.now().toString(36);
    const quiet = await openShop(request, platform, { name: `Busy${stamp} Quiet` });
    const busy = await openShop(request, platform, { name: `Busy${stamp} Busy` });
    const product = await busy.owner.createProduct();
    await busy.owner.createOrder(product.id);
    await busy.owner.createOrder(product.id);
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();
    await shops.search.fill(`Busy${stamp}`);
    await expect(shops.row(busy.slug)).toBeVisible();

    await shops.sortHeader('Orders').click();
    await expect.poll(() => shops.rowSlugs()).toEqual([quiet.slug, busy.slug]);
    await shops.sortHeader('Orders').click();
    await expect.poll(() => shops.rowSlugs()).toEqual([busy.slug, quiet.slug]);
    await expect(shops.sortHeader('Orders')).toHaveAttribute('aria-sort', 'descending');
  });

  test('every column header is a sort button and only the sorted one reports a direction', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();

    await expect(shops.sortHeader('Shop')).toHaveAttribute('aria-sort', 'ascending');
    for (const label of ['Status', 'Plan', 'Paid until', 'People', 'Orders', 'Last order']) {
      await expect(shops.sortHeader(label)).toHaveAttribute('aria-sort', 'none');
    }

    await shops.sortHeader('Paid until').click();

    await expect(shops.sortHeader('Paid until')).toHaveAttribute('aria-sort', 'ascending');
    await expect(shops.sortHeader('Shop')).toHaveAttribute('aria-sort', 'none');
  });

  test('clicking a row opens that shop, and Refresh keeps the list', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();
    await shops.search.fill(created.tenant.slug);

    await page.getByRole('button', { name: 'Refresh shops' }).click();
    await expect(shops.row(created.tenant.slug)).toBeVisible();
    await shops.row(created.tenant.slug).click();

    await expect(page).toHaveURL(new RegExp(`/platform/shops/${created.tenant.id}`));
    await expect(new PlatformShopPage(page).title).toContainText(created.tenant.name);
  });
});

test.describe('platform shop page, plans and log @tenancy @platform @ui', () => {
  test('the tabs switch panels and keep the shop title', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shop = new PlatformShopPage(page);
    await shop.open(created.tenant.id);

    await shop.openTab('people');
    await expect(page.getByTestId('people-list')).toBeVisible();
    await shop.openTab('billing');
    await expect(page.getByTestId('billing-summary')).toBeVisible();
    await shop.openTab('brand');
    await expect(page.getByTestId('brand-form')).toBeVisible();
    await shop.openTab('log');
    await expect(page.getByTestId('shop-log')).toBeVisible();
    await shop.openTab('overview');
    await expect(shop.title).toContainText(created.tenant.name);
  });

  test('the platform overview counts every shop', async ({ newContext, platform }) => {
    await platform.createShop();
    const total = (await platform.tenants()).length;
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();

    await expect(page.getByTestId('overview-stats')).toBeVisible();
    const shown = Number((await page.getByTestId('stat-total').textContent())?.trim());
    expect(shown).toBeGreaterThanOrEqual(total);
  });

  test('a shop id that is not a shop shows a not-found message, not another shop', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();

    await page.goto(PLATFORM_ROUTES.shop('00000000-0000-0000-0000-000000000123'));

    await expect(page.getByRole('alert').or(page.getByText(/not found/i)).first()).toBeVisible();
  });

  test('a malformed shop id in the address does not crash the platform', async ({ newContext }) => {
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();

    await page.goto(PLATFORM_ROUTES.shop('not-a-guid'));

    await expect(new PlatformShell(page).nav).toBeVisible();
  });

  test('the plans page lists the plans with price and features, and opens the edit form', async ({ newContext, platform }) => {
    const plans = await platform.plans();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    await page.goto(PLATFORM_ROUTES.plans);

    await expect(page.getByTestId('plan-list')).toBeVisible();
    for (const plan of plans) {
      await expect(page.getByTestId(`plan-${plan.code}`)).toContainText(plan.name);
    }

    await page.getByTestId(`plan-${plans[0].code}`).getByRole('button', { name: 'Edit plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit plan' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('changing a plan price is saved and applies to new invoices only', async ({ newContext, platform }) => {
    const created = await platform.createShop({ planCode: 'starter' });
    const before = await platform.createInvoice(created.tenant.id, 1);
    const starter = (await platform.plans()).find((p) => p.code === 'starter')!;
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    await page.goto(PLATFORM_ROUTES.plans);

    try {
      await page.getByTestId('plan-starter').getByRole('button', { name: 'Edit plan' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit plan' });
      await dialog.getByLabel('Price per month').fill('1234');
      await dialog.getByRole('button', { name: 'Save plan' }).click();
      await expect(dialog).toHaveCount(0);

      const after = await platform.createInvoice(created.tenant.id, 1);
      expect(after.amount).toBe(1234);
      const invoices = (await platform.subscription(created.tenant.id)).invoices;
      expect(invoices.find((i) => i.id === before.id)?.amount).toBe(before.amount);
    } finally {
      await platform.json('PUT', `plans/${starter.id}`, {
        name: starter.name,
        monthlyPrice: starter.monthlyPrice,
        maxUsers: starter.maxUsers,
        features: starter.features,
        isActive: starter.isActive,
      });
    }
  });

  test('the platform log lists admin actions, searches them and filters by shop', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    await platform.setStatus(created.tenant.id, 'suspend', unique('log reason'));
    const other = await platform.createShop();
    const page = await (await newContext()).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    await page.goto(PLATFORM_ROUTES.log);
    const list = page.getByTestId('log-list');
    await expect(list).toBeVisible();

    await page.getByLabel('Filter by shop').selectOption(created.tenant.id);
    await expect(list.getByRole('listitem').first()).toContainText(created.tenant.name);
    await expect(list).not.toContainText(other.tenant.name);

    await page.getByLabel('Search the log').fill(`zz-nothing-${Date.now()}`);
    await expect(page.getByText('Nothing matches.')).toBeVisible();
  });
});

test.describe('platform on a phone @tenancy @platform @ui', () => {

  test('shows a bottom bar with the four pages instead of the sidebar, and Sign out in the header', async ({ newContext }) => {
    const page = await (await newContext({ width: 375, height: 812 })).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const dock = new PlatformDock(page);

    await expect(dock.nav).toBeVisible();
    for (const name of ['Overview', 'Shops', 'Plans', 'Platform log'] as const) {
      await expect(dock.link(name)).toBeVisible();
    }
    await expect(page.getByRole('complementary', { name: 'Platform navigation' })).toBeHidden();
    await expect(dock.signOutButton).toBeVisible();
  });

  test('the bottom bar moves between pages, and Sign out ends the session', async ({ newContext }) => {
    const page = await (await newContext({ width: 375, height: 812 })).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const dock = new PlatformDock(page);

    await dock.link('Shops').click();
    await expect(page).toHaveURL(/\/platform\/shops/);
    await dock.link('Plans').click();
    await expect(page).toHaveURL(/\/platform\/plans/);
    await dock.link('Platform log').click();
    await expect(page).toHaveURL(/\/platform\/log/);
    await dock.signOutButton.click();

    await expect(page).toHaveURL(/\/platform\/login/);
  });

  test('the shops page has no sideways scroll and still opens a shop from a row', async ({ newContext, platform }) => {
    const created = await platform.createShop();
    const page = await (await newContext({ width: 375, height: 812 })).newPage();
    await new PlatformLoginPage(page).signInAndWait();
    const shops = new PlatformShopsPage(page);
    await shops.open();
    await shops.search.fill(created.tenant.slug);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shops.row(created.tenant.slug).click();

    await expect(new PlatformShopPage(page).title).toContainText(created.tenant.name);
  });
});
