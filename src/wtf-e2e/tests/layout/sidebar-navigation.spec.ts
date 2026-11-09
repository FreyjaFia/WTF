import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

const sidebarLink = (page: Page, name: string | RegExp): Locator =>
  page.locator('app-sidebar nav').getByRole('link', { name, exact: typeof name === 'string' });

test.describe('sidebar navigation @layout @navigation', () => {
  test('Inventory and Management are one entry each, and their pages are reached from the hub', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });

    const labels = await page.locator('app-sidebar nav a[title]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('title')),
    );
    expect(labels.filter((l) => l === 'Inventory')).toHaveLength(1);
    expect(labels.filter((l) => l === 'Management')).toHaveLength(1);
    for (const gone of ['Items', 'Receiving', 'Purchasing', 'Stock In', 'Products', 'Setup', 'Shop', 'Suppliers']) {
      await expect(sidebarLink(page, gone)).toHaveCount(0);
    }

    await page.getByTestId('sidebar-inventory').click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByTestId('inventory-hub')).toBeVisible();
    await page.getByTestId('inventory-card-receiving').click();
    await expect(page).toHaveURL(/\/inventory\/receiving$/);
    await expect(page.getByTestId('sidebar-inventory')).toHaveClass(/sidebar-active/);
  });

  test('a short window scrolls the sidebar so every link can be reached', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await page.setViewportSize({ width: 1280, height: 300 });

    const nav = page.locator('app-sidebar nav');
    const scrolls = await nav.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);

    const last = page.locator('app-sidebar nav a[title]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    await nav.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.locator('app-sidebar nav a[title]').first()).toBeInViewport();
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

  test('a Stock Manager gets a Management hub with only Setup inside', async ({ signIn }) => {
    const page = await signIn('stockmgr', { landing: true });

    await expect(sidebarLink(page, 'Dashboard')).toHaveCount(0);
    await page.getByTestId('sidebar-management').click();
    await expect(page.getByTestId('management-card-setup')).toBeVisible();
    for (const hidden of ['products', 'customers', 'users', 'promotions', 'reports', 'expenses', 'shop']) {
      await expect(page.getByTestId(`management-card-${hidden}`)).toHaveCount(0);
    }

    await page.getByTestId('management-card-setup').click();
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

    await admin.getByTestId('sidebar-management').click();
    await expect(admin.getByTestId('management-card-shop')).toHaveCount(1);
    await expect(admin.getByTestId('management-card-subscription')).toHaveCount(0);
    await admin.getByTestId('management-card-shop').click();
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

    await page.getByTestId('sidebar-management').click();
    await expect(page.getByTestId('management-card-shop')).toHaveCount(0);
    await page.goto('/management/shop');
    await expect(page).not.toHaveURL(/management\/shop/);
  });
});
