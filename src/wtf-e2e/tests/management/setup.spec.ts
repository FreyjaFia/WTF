import { expect, test } from '../../fixtures';

test.describe('setup page @management @setup', () => {
  test('the old catalog and waste reason addresses lead to the Setup lists', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });

    await page.goto('/management/catalog');
    await expect(page).toHaveURL(/\/management\/setup\/categories$/);

    await page.goto('/management/waste-reasons');
    await expect(page).toHaveURL(/\/management\/setup\/waste-reasons$/);
  });

  test('an Admin opens a list from the hub, sees its count and goes back', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await page.goto('/management/setup');

    await expect(page.getByTestId('setup-hub')).toBeVisible();
    for (const id of ['categories', 'subcategories', 'addon-types', 'waste-reasons']) {
      await expect(page.getByTestId(`setup-card-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('setup-count-waste-reasons')).toContainText('active');

    await page.getByTestId('setup-card-addon-types').click();
    await expect(page).toHaveURL(/\/management\/setup\/addon-types$/);
    await expect(page.getByRole('heading', { name: 'Add-on Types' })).toBeVisible();

    await page.getByTestId('setup-back').click();
    await expect(page).toHaveURL(/\/management\/setup$/);
    await expect(page.getByTestId('setup-hub')).toBeVisible();
  });

  test('an Admin Viewer sees the menu cards but not Waste Reasons', async ({ signIn }) => {
    const page = await signIn('viewer', { landing: true });
    await page.goto('/management/setup');

    await expect(page.getByTestId('setup-card-categories')).toBeVisible();
    await expect(page.getByTestId('setup-card-waste-reasons')).toHaveCount(0);

    await page.goto('/management/setup/waste-reasons');
    await expect(page).toHaveURL(/\/management\/setup$/);
  });

  test('on a phone the cards stack and a list opens full width', async ({ signIn }) => {
    const page = await signIn('admin', { landing: true });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/management/setup');

    await page.getByTestId('setup-card-waste-reasons').click();
    await expect(page).toHaveURL(/\/management\/setup\/waste-reasons$/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
