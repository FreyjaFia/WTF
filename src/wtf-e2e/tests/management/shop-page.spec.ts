import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';

const HUB = '/management/shop';
const BRANDING = '/management/shop/branding';
const PLAN = '/management/shop/plan';

test.describe('the Shop page works like the Setup page @management @layout', () => {
  test('the hub lists Branding and Plan & billing as cards, and each has a back button', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(HUB);

    await expect(page.getByTestId('shop-hub')).toBeVisible();
    await page.getByTestId('shop-card-plan').click();
    await expect(page).toHaveURL(/\/management\/shop\/plan$/);
    await expect(page.getByTestId('subscription-summary').or(page.getByText('This shop has no subscription limit.'))).toBeVisible();

    await page.getByTestId('shop-back').click();
    await expect(page).toHaveURL(/\/management\/shop$/);
    await page.getByTestId('shop-card-branding').click();
    await expect(page).toHaveURL(/\/management\/shop\/branding$/);
    await expect(page.getByTestId('brand-shopName')).toBeVisible();
  });

  test('the Save bar stays reachable and a bad colour is flagged before saving', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await page.goto(BRANDING);

    const save = page.getByTestId('brand-actions').getByRole('button', { name: 'Save' });
    await expect(save).toBeInViewport();

    const colour = page.getByTestId('brand-primaryColor');
    const original = await colour.inputValue();
    await colour.fill('not-a-colour');
    await colour.blur();
    await expect(page.getByText('Use a colour like #6f4e37.')).toBeVisible();
    await expect(save).toBeDisabled();

    await colour.fill(original);
    await expect(save).toBeEnabled();
  });

  for (const viewport of VIEWPORTS) {
    for (const path of [HUB, BRANDING, PLAN]) {
      test(`${path} fits without sideways scrolling at ${viewport.name}`, async ({ signIn }) => {
        const page = await signIn('admin');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
      });
    }
  }
});
