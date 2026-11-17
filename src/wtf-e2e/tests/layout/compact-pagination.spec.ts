import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { ROUTES } from '@data/routes';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';

const bar = (page: Page) => page.locator('app-pagination');

async function box(page: Page, selector: string) {
  const handle = page.locator(selector).locator('visible=true').first();
  await expect(handle).toBeVisible();
  const found = await handle.boundingBox();
  expect(found, selector).not.toBeNull();
  return found!;
}

test.describe('compact pagination and sub page headers @layout @paging', () => {
  for (const viewport of VIEWPORTS) {
    test(`waste reasons: the slim bar sits below the list and never covers a row on ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTES.wasteReasons);
      await expect(page.getByRole('heading', { name: 'Waste Reasons', exact: true })).toBeVisible();
      await expect(bar(page)).toBeVisible();

      const barBox = await box(page, 'app-pagination');
      expect(barBox.height, 'the paginator is one slim row').toBeLessThan(viewport.width < 640 ? 64 : 72);

      const firstRow = await box(page, 'app-waste-reasons li');
      expect(firstRow.y + firstRow.height <= barBox.y || firstRow.y >= barBox.y + barBox.height, 'the first row is not covered').toBe(true);

      expect(await page.locator('app-waste-reasons li app-pagination').count(), 'the bar is not inside a row').toBe(0);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/waste-reasons-${viewport.width}.png` });
      }
    });

    test(`setup sub page starts at the standard top spacing on ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTES.wasteReasons);
      const heading = await box(page, 'h1');
      const content = await box(page, '.app-content');
      expect(heading.y - content.y, 'no extra margin above the title').toBeLessThanOrEqual(40);
    });

    test(`ingredients and cost: the list gets the screen under the pinned search on ${viewport.name}`, async ({ api, signIn }) => {
      for (let i = 0; i < 30; i += 10) {
        await Promise.all(Array.from({ length: 10 }, () => api.products.create({ price: 100 })));
      }

      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTES.ingredients);
      await expect(bar(page)).toBeVisible();
      const firstRow = await box(page, '[data-testid="coverage-row"]');
      expect(firstRow.y, 'the first product starts in the upper two thirds').toBeLessThan(viewport.height * 0.65);
      const barBox = await box(page, 'app-pagination');
      expect(barBox.height).toBeLessThan(72);
      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/ingredients-${viewport.width}.png` });
      }
    });

    test(`an open report has one header and one back button on ${viewport.name}`, async ({ signIn }) => {
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTES.report('payments'));
      const back = page.getByRole('button', { name: 'Back to all reports' });
      await expect(back).toBeVisible();
      await expect(page.getByText('Loading profile')).toBeHidden();
      await expect(page.getByTestId('management-back')).toHaveCount(0);
      await expect(page.getByTestId('management-crumb')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Reports View' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/report-open-${viewport.width}.png` });
      }

      await back.click();
      await expect(page.getByRole('tab', { name: 'Reports View' })).toBeVisible();
      await expect(page.getByTestId('management-crumb')).toBeVisible();
    });
  }
});
