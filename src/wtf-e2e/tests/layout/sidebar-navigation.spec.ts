import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

const sidebarLink = (page: Page, name: string | RegExp): Locator =>
  page.locator('app-sidebar nav').getByRole('link', { name, exact: typeof name === 'string' });

test.describe('sidebar navigation @layout @navigation', () => {
  test('the Inventory group lists its links in working order and keeps Suppliers out', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });

    const labels = await page.locator('app-sidebar nav a[title]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('title')),
    );
    const inventory = labels.slice(labels.indexOf('Items'), labels.indexOf('Stock Counts') + 1);
    expect(inventory).toEqual([
      'Items',
      'Ingredients & Cost',
      'Needs Attention',
      'Purchasing',
      'Receiving',
      'Stock In',
      'Waste',
      'Stock Counts',
    ]);
    await expect(sidebarLink(page, 'Suppliers')).toHaveCount(0);
  });

  test('a short window scrolls the sidebar so every link can be reached', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await page.setViewportSize({ width: 1280, height: 480 });

    const nav = page.locator('app-sidebar nav');
    const scrolls = await nav.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);

    const last = page.locator('app-sidebar nav a[title]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    await nav.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(sidebarLink(page, 'Orders')).toBeInViewport();
    await expect(sidebarLink(page, 'Receiving')).toBeAttached();
  });

  test('every Inventory link is visible, not clipped, when the group is open', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    const receiving = sidebarLink(page, 'Receiving');
    await receiving.scrollIntoViewIfNeeded();
    await expect(receiving).toBeVisible();
    const box = await receiving.boundingBox();
    const group = await page.locator('app-sidebar nav a[title="Items"]').boundingBox();
    expect(box && group && box.y > group.y).toBe(true);
  });

  test('Suppliers lives in Setup, and the old address leads there', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });

    await page.goto('/management/setup');
    await expect(page.getByTestId('setup-card-suppliers')).toBeVisible();
    await page.getByTestId('setup-card-suppliers').click();
    await expect(page).toHaveURL(/\/management\/setup\/suppliers$/);
    await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible();
    await page.getByTestId('setup-back').click();
    await expect(page).toHaveURL(/\/management\/setup$/);

    await page.goto('/inventory/suppliers');
    await expect(page).toHaveURL(/\/management\/setup\/suppliers$/);
  });

  test('a Stock Manager gets Management with only Setup > Suppliers inside', async ({ signIn }) => {
    const page = await signIn('stockmgr', { landing: true });

    await expect(sidebarLink(page, 'Dashboard')).toHaveCount(0);
    await expect(sidebarLink(page, 'Setup')).toBeVisible();
    for (const hidden of ['Products', 'Customers', 'Users', 'Promotions', 'Reports', 'Expenses', 'Shop']) {
      await expect(sidebarLink(page, hidden)).toHaveCount(0);
    }

    await sidebarLink(page, 'Setup').click();
    await expect(page.getByTestId('setup-card-suppliers')).toBeVisible();
    await expect(page.getByTestId('setup-card-categories')).toHaveCount(0);
    await expect(page.getByTestId('setup-card-waste-reasons')).toHaveCount(0);

    await page.goto('/management/products');
    await expect(page).not.toHaveURL(/management\/products/);
    await page.goto('/management/shop');
    await expect(page).not.toHaveURL(/management\/shop/);
  });

  test('Subscription and Shop are one Shop entry that only an Admin sees', async ({ signIn }) => {
    const admin = await signIn('admin', { landing: true });

    await expect(sidebarLink(admin, 'Subscription')).toHaveCount(0);
    await expect(sidebarLink(admin, 'Shop')).toHaveCount(1);
    await sidebarLink(admin, 'Shop').click();
    await expect(admin).toHaveURL(/\/management\/shop$/);
    await admin.getByTestId('shop-card-branding').click();
    await expect(admin).toHaveURL(/\/management\/shop\/branding$/);
    await expect(admin.getByTestId('brand-shopName')).toBeVisible();

    await admin.getByTestId('shop-back').click();
    await admin.getByTestId('shop-card-plan').click();
    await expect(admin).toHaveURL(/\/management\/shop\/plan$/);
    await expect(admin.getByRole('heading', { name: 'Invoices' })).toBeVisible();

    await admin.goto('/management/subscription');
    await expect(admin).toHaveURL(/\/management\/shop\/plan$/);
    await admin.goto('/management/brand');
    await expect(admin).toHaveURL(/\/management\/shop\/branding$/);
  });

  test('an Admin Viewer sees no Shop entry and cannot open it', async ({ signIn }) => {
    const page = await signIn('viewer', { landing: true });

    await expect(sidebarLink(page, 'Shop')).toHaveCount(0);
    await page.goto('/management/shop');
    await expect(page).not.toHaveURL(/management\/shop/);
  });
});
