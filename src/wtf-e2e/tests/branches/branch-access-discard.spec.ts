import { ROUTES } from '@data/routes';
import { World, closeWorld, openWorld } from '@api/branch-scope';
import { expect, test } from '@fixtures/index';
import { go } from '@utils/navigation';

test.describe('branch access on the user page asks before unsaved changes are lost @branches', () => {
  let world: World | undefined;

  test.beforeEach(async ({ api }) => {
    world = await openWorld(api);
  });

  test.afterEach(async () => {
    await closeWorld(world);
  });

  test('leaving after a branch was ticked asks first, and saving access lets the person leave', async ({ signIn }) => {
    const shop = world!;
    const page = await signIn('owner');
    await go(page, `${ROUTES.users}/edit/${shop.manager.id}`);
    const box = page.getByTestId(`branch-access-${shop.branchB.code}`);
    await box.scrollIntoViewIfNeeded();
    await expect(box).not.toBeChecked();
    await box.check();

    await page.locator('a[href="/orders/list"]:visible').first().click();
    await expect(page.getByText('Discard Changes?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page).toHaveURL(/management\/users\/edit/);
    await expect(box).toBeChecked();

    await page.getByTestId('save-branch-access').click();
    await expect(page.getByText('Branch access saved.')).toBeVisible();
    await page.locator('a[href="/orders/list"]:visible').first().click();
    await expect(page).toHaveURL(/orders\/list/);
    await expect(page.getByText('Discard Changes?')).toHaveCount(0);
  });

  test('leaving without touching the branch access does not ask', async ({ signIn }) => {
    const shop = world!;
    const page = await signIn('owner');
    await go(page, `${ROUTES.users}/edit/${shop.manager.id}`);
    await expect(page.getByTestId(`branch-access-${shop.branchA.code}`)).toBeChecked();
    await page.locator('a[href="/orders/list"]:visible').first().click();
    await expect(page).toHaveURL(/orders\/list/);
    await expect(page.getByText('Discard Changes?')).toHaveCount(0);
  });
});
