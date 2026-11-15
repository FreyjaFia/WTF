import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ROUTES } from '@data/routes';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const COUNT = 30;

const bar = (page: Page) => page.locator('app-pagination');
const name = (stamp: string, index: number): string => `${stamp}${String(index).padStart(2, '0')}`;

async function seedItems(api: Api): Promise<string> {
  const stamp = unique('Pgi').replace(' ', '');
  for (let i = 0; i < COUNT; i += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, COUNT - i) }, (_, k) =>
        api.items.create({ name: name(stamp, i + k), startingQuantity: i + k + 1 }),
      ),
    );
  }

  return stamp;
}

async function openAndSearch(page: Page, stamp: string): Promise<void> {
  await page.goto(ROUTES.items);
  const answered = page.waitForResponse((response) => response.url().includes('/items/paged') && response.url().includes(stamp));
  await page.locator('input[placeholder^="Search"]').locator('visible=true').first().fill(stamp);
  await answered;
  await expect(bar(page)).toContainText(`1 – 25 of ${COUNT}`);
}

test.describe('paginated lists: inventory items @inventory @items @paging', () => {
  test('pages the item list on the server and keeps the page in the address', async ({ api, signIn }) => {
    const stamp = await seedItems(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);

    await expect(page.getByText(name(stamp, 0), { exact: true }).locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(name(stamp, 29), { exact: true })).toHaveCount(0);

    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(bar(page)).toContainText(`26 – ${COUNT} of ${COUNT}`);
    await expect(page.getByText(name(stamp, 29), { exact: true }).locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(name(stamp, 0), { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(bar(page)).toContainText(`26 – ${COUNT} of ${COUNT}`);
  });

  test('sorting by stock orders the whole list, not just the page, and returns to page one', async ({ api, signIn }) => {
    const stamp = await seedItems(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);
    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);

    await page.getByRole('button', { name: 'Sort by Stock' }).first().click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(bar(page)).toContainText(`1 – 25 of ${COUNT}`);
    await expect(page.getByText(name(stamp, 0), { exact: true }).locator('visible=true').first()).toBeVisible();

    await page.getByRole('button', { name: 'Sort by Stock' }).first().click();
    await expect(page.getByText(name(stamp, 29), { exact: true }).locator('visible=true').first()).toBeVisible();
    await expect(page.getByText(name(stamp, 0), { exact: true })).toHaveCount(0);
  });

  test('rows per page is remembered after a reload', async ({ api, signIn }) => {
    const stamp = await seedItems(api);
    const page = await signIn('owner');
    await openAndSearch(page, stamp);

    await bar(page).locator('select').selectOption('10');
    await expect(bar(page)).toContainText(`1 – 10 of ${COUNT}`);

    await page.reload();
    await expect(bar(page).locator('select')).toHaveValue('10');
  });

  for (const viewport of VIEWPORTS) {
    test(`the item list and its pagination bar fit at ${viewport.name}`, async ({ api, signIn }) => {
      const stamp = await seedItems(api);
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openAndSearch(page, stamp);

      await expect(bar(page)).toBeVisible();
      const overflow = await measureOverflow(page);
      expect(overflowProblem(overflow), overflowProblem(overflow) ?? undefined).toBeNull();
    });
  }
});

test.describe('paginated lists: stock history and waste @inventory @paging', () => {
  test('the waste list pages on the server', async ({ api, signIn }) => {
    const stamp = unique('PgWaste').replace(' ', '');
    const item = await api.items.create({ name: stamp, startingQuantity: 1000 });
    for (let i = 0; i < 27; i += 9) {
      await Promise.all(Array.from({ length: 9 }, () => api.waste.record(item.id, { quantity: 1 })));
    }

    const page = await signIn('owner');
    await page.goto(ROUTES.waste);
    await page.getByLabel('Search waste').fill(stamp);
    await expect(bar(page)).toContainText('1 – 25 of 27');
    await expect(page.locator('li[data-testid^="waste-"]').locator('visible=true')).toHaveCount(25);

    await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.locator('li[data-testid^="waste-"]').locator('visible=true')).toHaveCount(2);
  });

  test('the item stock history pages with the bar instead of Load More', async ({ api, signIn }) => {
    const item = await api.items.create({ startingQuantity: 1000 });
    for (let i = 0; i < 27; i += 9) {
      await Promise.all(Array.from({ length: 9 }, () => api.waste.record(item.id, { quantity: 1 })));
    }

    const page = await signIn('owner');
    await page.goto(ROUTES.itemDetails(item.id));
    await expect(bar(page)).toContainText('of 28');
    await expect(page.getByRole('button', { name: 'Load More' })).toHaveCount(0);
  });
});
