import { Page } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { OrderStatus } from '@data/enums';
import { OrderListPage } from '@pages/order-list.page';
import { measureOverflow, overflowProblem, VIEWPORTS } from '@utils/layout';
import { unique } from '@utils/unique';

const COMPLETED = 30;
const PENDING = 17;
const TOTAL = COMPLETED + PENDING;

interface Seeded {
  readonly name: string;
  readonly numbers: readonly number[];
}

async function seedOrders(api: Api): Promise<Seeded> {
  const name = unique('Pager');
  const customer = await api.customers.create(name);
  const product = await api.products.create({ price: 100 });
  const numbers: number[] = [];
  const statuses = [...Array<number>(COMPLETED).fill(OrderStatus.Completed), ...Array<number>(PENDING).fill(OrderStatus.Pending)];
  for (let i = 0; i < statuses.length; i += 8) {
    const batch = await Promise.all(
      statuses.slice(i, i + 8).map((status) => api.orders.create({ items: [{ productId: product.id, quantity: 1 }], status, customerId: customer.id })),
    );
    numbers.push(...batch.map((order) => order.orderNumber));
  }

  return { name, numbers };
}

async function search(page: Page, name: string): Promise<void> {
  const answered = page.waitForResponse((response) => response.url().includes('/orders/paged') && response.url().includes(encodeURIComponent(name)));
  await page.locator('input[placeholder="Search by order # or customer"]').locator('visible=true').first().fill(name);
  await answered;
  await expect(rows(page).first()).toContainText(name);
  await expect(page.locator('[data-testid="order-row"].opacity-60, .opacity-60 [data-testid="order-row"]')).toHaveCount(0);
}

function rows(page: Page) {
  return page.getByTestId('order-row');
}

async function scrollToEnd(page: Page): Promise<void> {
  await page.getByText(/You are all caught up|Tap to retry/).or(page.locator('app-scroll-loader')).first().scrollIntoViewIfNeeded();
}

async function rowNumbers(page: Page): Promise<number[]> {
  const values = await rows(page).evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-order-number'))));
  return values;
}

test.describe('order list paging @orders @paging', () => {
  test('rows load by scrolling, with no Load more button and no repeated order', async ({ api, signIn }) => {
    const seeded = await seedOrders(api);
    const page = await signIn('owner');
    const list = new OrderListPage(page);
    await list.open();
    await search(page, seeded.name);

    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByRole('button', { name: /load more/i })).toHaveCount(0);

    await rows(page).last().scrollIntoViewIfNeeded();
    await expect(rows(page)).toHaveCount(40);

    await rows(page).last().scrollIntoViewIfNeeded();
    await expect(rows(page)).toHaveCount(TOTAL);
    await expect(page.getByText('You are all caught up')).toBeVisible();

    const numbers = await rowNumbers(page);
    expect(new Set(numbers).size).toBe(TOTAL);
    expect(numbers).toEqual([...seeded.numbers].sort((a, b) => b - a));
  });

  test('status chips count every order of the search, not just the loaded rows, and filter on the server', async ({ api, signIn }) => {
    const seeded = await seedOrders(api);
    const page = await signIn('owner');
    const list = new OrderListPage(page);
    await list.open();
    await search(page, seeded.name);
    await expect(rows(page)).toHaveCount(20);

    await page.getByRole('button', { name: /^Filters/ }).click();
    const drawer = page.getByRole('dialog').or(page.locator('app-side-drawer')).first();
    const completed = page.locator('label', { hasText: 'Completed' }).filter({ has: page.locator('input[type=checkbox]') }).first();
    const pending = page.locator('label', { hasText: 'Pending' }).filter({ has: page.locator('input[type=checkbox]') }).first();
    await expect(completed).toContainText(String(COMPLETED));
    await expect(pending).toContainText(String(PENDING));
    expect(drawer).toBeTruthy();

    await pending.locator('input').check();
    await expect(rows(page)).toHaveCount(Math.min(PENDING, 20));
    await expect(completed).toContainText(String(COMPLETED));
  });

  test('sorting by order number sends the sort to the server and starts again at the top', async ({ api, signIn }) => {
    const seeded = await seedOrders(api);
    const page = await signIn('owner');
    const list = new OrderListPage(page);
    await list.open();
    await search(page, seeded.name);
    await expect(rows(page)).toHaveCount(20);

    const response = page.waitForResponse((r) => r.url().includes('/orders/paged') && r.url().includes('sortBy=orderNumber') && r.url().includes('sortDirection=asc'));
    await page.getByRole('button', { name: 'Order', exact: true }).first().click();
    await page.getByRole('button', { name: 'Order', exact: true }).first().click();
    await response;

    const lowest = Math.min(...seeded.numbers);
    await expect(rows(page).first()).toHaveAttribute('data-order-number', String(lowest));
  });

  test('coming back from an order opens the list where it was', async ({ api, signIn }) => {
    const seeded = await seedOrders(api);
    const page = await signIn('owner');
    const list = new OrderListPage(page);
    await list.open();
    await search(page, seeded.name);
    await expect(rows(page)).toHaveCount(20);
    await rows(page).last().scrollIntoViewIfNeeded();
    await expect(rows(page)).toHaveCount(40);

    const target = rows(page).nth(35);
    const number = await target.getAttribute('data-order-number');
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await expect(page).toHaveURL(/orders\/.+/);

    await page.goBack();
    await expect.poll(() => rows(page).count()).toBeGreaterThanOrEqual(40);
    await expect(page.locator(`[data-order-number="${number}"]`)).toBeInViewport();
  });

  for (const viewport of VIEWPORTS) {
    test(`the list pages without overflow on ${viewport.name}`, async ({ api, signIn }) => {
      const seeded = await seedOrders(api);
      const page = await signIn('owner');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const list = new OrderListPage(page);
      await list.open();
      await search(page, seeded.name);
      await expect(rows(page)).toHaveCount(20);
      await rows(page).last().scrollIntoViewIfNeeded();
      await expect(rows(page)).toHaveCount(40);
      await scrollToEnd(page);

      expect(overflowProblem(await measureOverflow(page))).toBeNull();
      if (process.env.E2E_SHOTS) {
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/orders-paging-${viewport.width}.png` });
      }
    });
  }
});
