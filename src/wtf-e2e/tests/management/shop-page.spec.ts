import { expect, test } from '@fixtures/index';
import { VIEWPORTS, measureOverflow, overflowProblem } from '@utils/layout';

const BRANDING = '/management/shop/branding';
const PLAN = '/management/shop/plan';

test.describe('the Shop page matches the other Management screens @management @layout', () => {
  test('the tabs mark the open section and switch between Branding and Plan & billing', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(BRANDING);

    const branding = page.getByTestId('shop-tab-branding');
    const plan = page.getByTestId('shop-tab-plan');
    await expect(branding).toHaveAttribute('aria-selected', 'true');
    await expect(plan).toHaveAttribute('aria-selected', 'false');

    await plan.click();
    await expect(page).toHaveURL(/\/management\/shop\/plan$/);
    await expect(plan).toHaveAttribute('aria-selected', 'true');
    await expect(branding).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('subscription-summary').or(page.getByText('This shop has no subscription limit.'))).toBeVisible();
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
    for (const path of [BRANDING, PLAN]) {
      test(`${path} fits without sideways scrolling at ${viewport.name}`, async ({ signIn }) => {
        const page = await signIn('admin');
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(path);
        await expect(page.getByRole('heading', { name: 'Shop', exact: true })).toBeVisible();
        expect(overflowProblem(await measureOverflow(page))).toBeNull();
      });
    }
  }
});
