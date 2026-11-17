import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ROUTES } from '@data/routes';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const COUNT = 57;

async function seedCustomers(api: Api): Promise<string> {
  const stamp = unique('Pgr').replace(' ', '');
  for (let i = 0; i < COUNT; i += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, COUNT - i) }, (_, k) => api.customers.create(`${stamp}${String(i + k).padStart(3, '0')}`)),
    );
  }

  return stamp;
}

function rows(page: Page) {
  return page.getByTestId('list-row');
}

async function openAndSearch(page: Page, stamp: string): Promise<void> {
  await page.goto(ROUTES.customers);
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  const search = page.locator('input[placeholder^="Search"]').locator('visible=true').first();
  // A slow first load can finish after the typed search and reset the box, so type it again until the list is filtered.
  await expect(async () => {
    await search.fill(stamp);
    await expect(rows(page).first()).toContainText(stamp, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('app-pagination')).toContainText(`of ${COUNT}`);
}

const bar = (page: Page) => page.locator('app-pagination');

test.describe('paginated lists: customers @management @paging', () => {
  test('pages forward and back with the range, the page in the address and no repeated row', async ({ api, signIn }) => {
    const stamp = await seedCustomers(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);

    await expect(rows(page)).toHaveCount(25);
    await expect(bar(page)).toContainText(`1 – 25 of ${COUNT}`);
    const firstPage = await rows(page).allInnerTexts();

    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(bar(page)).toContainText(`26 – 50 of ${COUNT}`);
    await expect(rows(page)).toHaveCount(25);
    await expect
      .poll(async () => (await rows(page).allInnerTexts()).filter((row) => firstPage.includes(row)))
      .toEqual([]);

    await bar(page).getByRole('button', { name: 'Page 3', exact: true }).click();
    await expect(rows(page)).toHaveCount(COUNT - 50);
    await expect(bar(page)).toContainText(`51 – ${COUNT} of ${COUNT}`);
    await expect(bar(page).getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

    await bar(page).getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(rows(page)).toHaveCount(25);
  });

  test('rows per page, search and sort go back to page one, and the page size is remembered', async ({ api, signIn }) => {
    const stamp = await seedCustomers(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);
    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);

    await bar(page).getByLabel('Rows per page').selectOption('10');
    await expect(rows(page)).toHaveCount(10);
    await expect(bar(page)).toContainText(`1 – 10 of ${COUNT}`);
    await expect(page).not.toHaveURL(/page=/);

    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await page.getByRole('button', { name: 'Sort by Name' }).first().click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(bar(page)).toContainText(`1 – 10 of ${COUNT}`);

    await page.reload();
    await expect(bar(page).getByLabel('Rows per page')).toHaveValue('10');
  });

  test('coming back from a customer returns to the same page', async ({ api, signIn }) => {
    const stamp = await seedCustomers(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);
    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(bar(page)).toContainText(`26 – 50 of ${COUNT}`);
    await expect(page).toHaveURL(/[?&]page=2/);

    await rows(page).nth(3).locator('a').first().click();
    await expect(page).toHaveURL(/customers\/details\//);
    await page.goBack();

    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(bar(page)).toContainText(`26 – 50 of ${COUNT}`);
  });

  for (const viewport of VIEWPORTS) {
    test(`the bar fits and the list does not overflow on ${viewport.name}`, async ({ api, signIn }) => {
      const stamp = await seedCustomers(api);
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openAndSearch(page, stamp);
      await expect(bar(page)).toBeVisible();
      await bar(page).scrollIntoViewIfNeeded();
      if (viewport.width < 640) {
        await expect(bar(page).getByLabel('Go to page')).toHaveValue('1');
        await expect(bar(page)).toContainText('of 3');
        await bar(page).getByLabel('Go to page').selectOption('3');
        await expect(page).toHaveURL(/[?&]page=3/);
        await expect(bar(page).getByRole('button', { name: 'Page 2', exact: true })).toBeHidden();
      } else {
        await expect(bar(page).getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
      }

      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/customers-paging-${viewport.width}.png` });
      }
    });
  }
});
