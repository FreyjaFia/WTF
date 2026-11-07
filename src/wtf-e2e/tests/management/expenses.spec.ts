import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ROUTES } from '@data/routes';
import { VIEWPORTS, measureOverflow, overflowProblem, useStyle } from '@utils/layout';
import { today } from '@utils/dates';

interface Expense {
  readonly id: string;
  readonly expenseDate: string;
  readonly category: number;
  readonly categoryName: string;
  readonly amount: number;
  readonly note: string | null;
  readonly isActive: boolean;
}

interface ExpenseList {
  readonly items: Expense[];
  readonly total: number;
  readonly byCategory: ReadonlyArray<{ readonly category: number; readonly categoryName: string; readonly count: number; readonly amount: number }>;
}

interface ProfitLossRow {
  readonly periodStart: string;
  readonly netSales: number;
  readonly actualProfit: number | null;
  readonly expenses: number;
  readonly operatingProfit: number | null;
  readonly marginPercent: number | null;
  readonly costStatus: string;
}

const RENT = 1;
const UTILITIES = 3;
const OTHER = 8;

// The browser tests share one database, so every test books its expenses on its own day long ago, where nothing else
// sells or spends, and reads only that day back. A worker owns a block of 60 days, so two workers never share a day.
let nextDay = 0;
function quietDay(): string {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 100;
  const offset = worker * 60 + (nextDay % 55);
  nextDay += 1;
  return addDays('2005-01-01', offset);
}

function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

async function create(api: Api, expenseDate: string, category: number, amount: number, note: string | null = null): Promise<Expense> {
  return api.client.json<Expense>('admin', 'POST', 'expenses', { expenseDate, category, amount, note });
}

async function list(api: Api, from: string, to: string, extra: string = ''): Promise<ExpenseList> {
  return api.client.json<ExpenseList>('admin', 'GET', `expenses?fromDate=${from}&toDate=${to}${extra}`);
}

async function profitLoss(api: Api, from: string, to: string, groupBy: string = 'Day'): Promise<ProfitLossRow[]> {
  return api.client.json<ProfitLossRow[]>('admin', 'GET', `reports/profit-loss?fromDate=${from}&toDate=${to}&groupBy=${groupBy}`);
}

test.describe('expenses API @management @expenses', () => {
  test('an expense is saved, listed with a total and totals by category', async ({ api }) => {
    const day = quietDay();
    await create(api, day, RENT, 12000.5, 'Monthly rent');
    await create(api, day, UTILITIES, 800);
    await create(api, day, UTILITIES, 200.25, 'Water');

    const result = await list(api, day, day);

    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(13000.75);
    expect(result.byCategory.find((c) => c.categoryName === 'Rent')?.amount).toBe(12000.5);
    expect(result.byCategory.find((c) => c.categoryName === 'Utilities')).toMatchObject({ count: 2, amount: 1000.25 });
    expect(result.items.find((e) => e.note === 'Monthly rent')?.categoryName).toBe('Rent');
  });

  test('the eight categories are listed, and only Other needs a note', async ({ api }) => {
    const categories = await api.client.json<Array<{ id: number; name: string; needsNote: boolean }>>('admin', 'GET', 'expenses/categories');

    expect(categories.map((c) => c.name)).toEqual(['Rent', 'Salaries', 'Utilities', 'Supplies', 'Marketing', 'Delivery', 'Payment fees', 'Other']);
    expect(categories.filter((c) => c.needsNote).map((c) => c.name)).toEqual(['Other']);
  });

  test('bad input is refused with a 400 and nothing is saved', async ({ api }) => {
    const day = quietDay();
    const bad: ReadonlyArray<[string, unknown]> = [
      ['a zero amount', { expenseDate: day, category: RENT, amount: 0 }],
      ['a negative amount', { expenseDate: day, category: RENT, amount: -5 }],
      ['an amount above the limit', { expenseDate: day, category: RENT, amount: 100000001 }],
      ['category 0', { expenseDate: day, category: 0, amount: 5 }],
      ['category 9', { expenseDate: day, category: 9, amount: 5 }],
      ['Other with no note', { expenseDate: day, category: OTHER, amount: 5 }],
      ['Other with a blank note', { expenseDate: day, category: OTHER, amount: 5, note: '   ' }],
      ['a note over 200 characters', { expenseDate: day, category: RENT, amount: 5, note: 'x'.repeat(201) }],
      ['a date before 2000', { expenseDate: '1999-12-31', category: RENT, amount: 5 }],
      ['a date more than a year ahead', { expenseDate: addDays(today(), 400), category: RENT, amount: 5 }],
    ];

    for (const [label, body] of bad) {
      const response = await api.client.call('admin', 'POST', 'expenses', { body });
      expect.soft(response.status(), `${label}: ${await response.text()}`).toBe(400);
    }

    expect((await list(api, day, day)).items).toHaveLength(0);
  });

  test('Other is accepted with a note, and an amount of one centavo is allowed', async ({ api }) => {
    const day = quietDay();
    await create(api, day, OTHER, 0.01, 'Locksmith');

    const result = await list(api, day, day);

    expect(result.total).toBe(0.01);
    expect(result.items[0].note).toBe('Locksmith');
  });

  test('an expense can be edited, and the edit moves it between days', async ({ api }) => {
    const first = quietDay();
    const second = addDays(first, 2);
    const saved = await create(api, first, RENT, 100);

    await api.client.json('admin', 'PUT', `expenses/${saved.id}`, { expenseDate: second, category: UTILITIES, amount: 150.5, note: 'Power' });

    expect((await list(api, first, first)).items).toHaveLength(0);
    const moved = (await list(api, second, second)).items[0];
    expect(moved).toMatchObject({ categoryName: 'Utilities', amount: 150.5, note: 'Power' });
  });

  test('a deleted expense leaves the list and the total, shows with includeDeleted, and comes back on restore', async ({ api }) => {
    const day = quietDay();
    const kept = await create(api, day, RENT, 100);
    const removed = await create(api, day, UTILITIES, 40);

    await api.client.json('admin', 'DELETE', `expenses/${removed.id}`);
    const hidden = await list(api, day, day);
    expect(hidden.items.map((e) => e.id)).toEqual([kept.id]);
    expect(hidden.total).toBe(100);

    const shown = await list(api, day, day, '&includeDeleted=true');
    expect(shown.items).toHaveLength(2);
    expect(shown.items.find((e) => e.id === removed.id)?.isActive).toBe(false);
    expect(shown.total).toBe(100);

    await api.client.json('admin', 'POST', `expenses/${removed.id}/restore`, {});
    expect((await list(api, day, day)).total).toBe(140);
  });

  test('a deleted expense cannot be edited until it is restored', async ({ api }) => {
    const day = quietDay();
    const saved = await create(api, day, RENT, 100);
    await api.client.json('admin', 'DELETE', `expenses/${saved.id}`);

    const response = await api.client.call('admin', 'PUT', `expenses/${saved.id}`, {
      body: { expenseDate: day, category: RENT, amount: 1, note: null },
    });

    expect(response.status()).toBe(400);
    expect((await response.text()).toLowerCase()).toContain('restore');
  });

  test('an unknown expense gives 404 on edit, delete and restore', async ({ api }) => {
    const id = '3f2b8c1e-5a6d-4e7f-9b0a-1c2d3e4f5a6b';
    const edit = await api.client.call('admin', 'PUT', `expenses/${id}`, { body: { expenseDate: today(), category: RENT, amount: 1 } });
    const remove = await api.client.call('admin', 'DELETE', `expenses/${id}`);
    const restore = await api.client.call('admin', 'POST', `expenses/${id}/restore`, { body: {} });

    expect([edit.status(), remove.status(), restore.status()]).toEqual([404, 404, 404]);
  });

  test('a start date after the end date is a 400', async ({ api }) => {
    const response = await api.client.call('admin', 'GET', 'expenses?fromDate=2026-03-10&toDate=2026-03-01');
    expect(response.status()).toBe(400);
  });

  test('the category filter narrows the list and the totals', async ({ api }) => {
    const day = quietDay();
    await create(api, day, RENT, 100);
    await create(api, day, UTILITIES, 40);

    const result = await list(api, day, day, `&category=${UTILITIES}`);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(40);
  });

  test('the admin viewer can read but not write, the cashier can do neither', async ({ api }) => {
    const day = quietDay();
    const saved = await create(api, day, RENT, 100);

    expect((await api.client.call('viewer', 'GET', `expenses?fromDate=${day}&toDate=${day}`)).status()).toBe(200);
    expect((await api.client.call('viewer', 'DELETE', `expenses/${saved.id}`)).status()).toBe(403);
    expect((await api.client.call('cashier', 'GET', `expenses?fromDate=${day}&toDate=${day}`)).status()).toBe(403);
    expect((await list(api, day, day)).items).toHaveLength(1);
  });

  test('creating, editing, deleting and restoring each leave an audit entry', async ({ api }) => {
    const day = quietDay();
    const saved = await create(api, day, RENT, 100);
    await api.client.json('superadmin', 'PUT', `expenses/${saved.id}`, { expenseDate: day, category: RENT, amount: 120, note: null });
    await api.client.json('superadmin', 'DELETE', `expenses/${saved.id}`);
    await api.client.json('superadmin', 'POST', `expenses/${saved.id}/restore`, {});

    const logs = await api.client.json<{ items: Array<{ action: string; entityId?: string | null }> }>('superadmin', 'GET', `audit-logs?entityId=${saved.id}&page=1&pageSize=20`);
    const actions = logs.items.map((l) => l.action);

    expect(actions).toEqual(expect.arrayContaining(['ExpenseCreated', 'ExpenseUpdated', 'ExpenseDeleted', 'ExpenseRestored']));
  });
});

test.describe('the Profit and Loss report @reports @expenses', () => {
  test('a day with only expenses is a loss, with no margin', async ({ api }) => {
    const day = quietDay();
    await create(api, day, RENT, 12000);
    await create(api, day, UTILITIES, 800);

    const rows = await profitLoss(api, day, day);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ netSales: 0, actualProfit: 0, expenses: 12800, operatingProfit: -12800, marginPercent: null, costStatus: 'Known' });
  });

  test('a deleted expense and an expense on another day are left out', async ({ api }) => {
    const day = quietDay();
    await create(api, day, RENT, 100);
    const removed = await create(api, day, RENT, 5000);
    await create(api, addDays(day, 3), RENT, 7000);
    await api.client.json('admin', 'DELETE', `expenses/${removed.id}`);

    const rows = await profitLoss(api, day, day);

    expect(rows.map((r) => r.expenses)).toEqual([100]);
  });

  test('by month the whole month is one row, and by week each Monday-based week is one', async ({ api }) => {
    const monday = '2001-03-05';
    await create(api, '2001-03-05', RENT, 10);
    await create(api, '2001-03-11', RENT, 20);
    await create(api, '2001-03-12', RENT, 40);
    await create(api, '2001-03-31', RENT, 80);

    const month = await profitLoss(api, '2001-03-01', '2001-03-31', 'Month');
    expect(month).toHaveLength(1);
    expect(month[0].expenses).toBe(150);
    expect(month[0].periodStart.slice(0, 10)).toBe('2001-03-01');

    const weeks = await profitLoss(api, '2001-03-01', '2001-03-31', 'Week');
    expect(weeks.map((w) => [w.periodStart.slice(0, 10), w.expenses])).toEqual([
      [monday, 30],
      ['2001-03-12', 40],
      ['2001-03-26', 80],
    ]);
  });

  test('on a day with sales, operating profit is the gross profit less the expenses', async ({ api }) => {
    const milk = await api.items.create({ startingQuantity: 10000, unitName: 'milliliter', costPrice: 0.1 });
    const latte = await api.products.create({ price: 150 });
    await api.items.linkProducts(milk.id, [{ productId: latte.id, quantityPerSale: 200 }]);
    await api.orders.create({ items: [{ productId: latte.id, quantity: 2 }] });
    await create(api, today(), RENT, 123.45);

    const rows = await profitLoss(api, today(), today());
    const row = rows[0];

    expect(row.expenses).toBeGreaterThanOrEqual(123.45);
    expect(row.netSales).toBeGreaterThanOrEqual(300);
    expect(row.operatingProfit).not.toBeNull();
    expect(Math.round(((row.actualProfit ?? 0) - row.expenses) * 100)).toBe(Math.round((row.operatingProfit ?? 0) * 100));
  });

  test('it downloads as CSV-ready JSON for the viewer and is refused to the cashier', async ({ api }) => {
    const day = quietDay();
    expect((await api.client.call('viewer', 'GET', `reports/profit-loss?fromDate=${day}&toDate=${day}`)).status()).toBe(200);
    expect((await api.client.call('cashier', 'GET', `reports/profit-loss?fromDate=${day}&toDate=${day}`)).status()).toBe(403);
    expect((await api.client.call('stockmgr', 'GET', `reports/profit-loss?fromDate=${day}&toDate=${day}`)).status()).toBe(403);
  });

  test('a missing date, a reversed range and an unknown grouping are refused', async ({ api }) => {
    expect((await api.client.call('admin', 'GET', 'reports/profit-loss')).status()).toBe(400);
    expect((await api.client.call('admin', 'GET', `reports/profit-loss?fromDate=${today()}&toDate=2001-01-01`)).status()).toBe(400);
    expect((await api.client.call('admin', 'GET', `reports/profit-loss?fromDate=${today()}&toDate=${today()}&groupBy=Century`)).status()).toBe(400);
  });

  test('the report opens from the catalog and shows the expense row and the totals', async ({ api, signIn }) => {
    await create(api, today(), RENT, 321.09);

    const page = await signIn('admin');
    await page.goto(ROUTES.report('profit-loss'));

    await expect(page.getByRole('heading', { name: /profit and loss/i }).first()).toBeVisible();
    await expect(page.getByText('Operating Profit').first()).toBeVisible();
    await expect(page.getByText('Expenses').first()).toBeVisible();
    await expect(page.getByText(/an estimate/i).first()).toBeVisible();
  });
});

test.describe('the Expenses page @management @expenses', () => {
  type Page = import('@playwright/test').Page;

  async function openFilters(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('heading', { name: 'Expense Filters' })).toBeVisible();
  }

  async function closeFilters(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Close filters' }).first().click();
  }

  async function fillRange(page: Page, from: string, to: string): Promise<void> {
    await openFilters(page);
    // The end first: a range that is briefly reversed loads nothing, where an end still in the future would load too much.
    await page.locator('#expense-to').fill(to);
    await page.locator('#expense-from').fill(from);
    await page.locator('#expense-from').press('Tab');
  }

  async function filterTo(page: Page, from: string, to: string): Promise<void> {
    await fillRange(page, from, to);
    await closeFilters(page);
  }

  test('an admin adds, edits, deletes and restores an expense on screen', async ({ signIn }) => {
    const day = quietDay();
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);
    await filterTo(page, day, day);
    await expect(page.getByText('No expenses found')).toBeVisible();

    await page.getByTestId('add-expense').click();
    await page.locator('#expense-date').fill(day);
    await page.locator('#expense-category').selectOption({ label: 'Rent' });
    await page.locator('#expense-amount').fill('1500.50');
    await page.locator('#expense-note').fill('Shop rent');
    await page.getByRole('button', { name: 'Add Expense' }).last().click();

    await expect(page.getByTestId('expense-row')).toHaveCount(1);
    await expect(page.getByTestId('expense-total')).toContainText('1,500.50');
    await expect(page.getByTestId('expense-row')).toContainText('Shop rent');

    await page.getByRole('button', { name: 'Expense actions' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('#expense-amount').fill('1600');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('expense-total')).toContainText('1,600.00');

    await page.getByRole('button', { name: 'Expense actions' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No expenses found')).toBeVisible();
    await expect(page.getByTestId('expense-total')).toContainText('0.00');

    await openFilters(page);
    await page.getByText('Show deleted').click();
    await closeFilters(page);
    await expect(page.getByTestId('expense-row')).toHaveCount(1);
    await expect(page.getByTestId('expense-row')).toContainText('Deleted');
    await expect(page.getByTestId('expense-total')).toContainText('0.00');

    await page.getByRole('button', { name: 'Expense actions' }).click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('expense-total')).toContainText('1,600.00');
    await page.getByRole('button', { name: 'Expense actions' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test('Other asks for a note and the dialog says so', async ({ signIn }) => {
    const day = quietDay();
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);
    await filterTo(page, day, day);

    await page.getByTestId('add-expense').click();
    await expect(page.getByText('Note (optional)')).toBeVisible();
    await page.locator('#expense-category').selectOption({ label: 'Other' });
    await expect(page.getByText('Note (required)')).toBeVisible();
    await page.locator('#expense-date').fill(day);
    await page.locator('#expense-amount').fill('50');
    await page.getByRole('button', { name: 'Add Expense' }).last().click();

    await expect(page.getByRole('alert').filter({ hasText: 'A note is required for Other.' })).toBeVisible();
    const note = `Locksmith ${Date.now()}`;
    await expect(page.getByTestId('expense-row').filter({ hasText: note })).toHaveCount(0);

    await page.locator('#expense-note').fill(note);
    await page.getByRole('button', { name: 'Add Expense' }).last().click();
    await expect(page.getByTestId('expense-row').filter({ hasText: note })).toHaveCount(1);
  });

  test('a zero amount is refused on screen and keeps the dialog open', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);

    await page.getByTestId('add-expense').click();
    await page.locator('#expense-amount').fill('0');
    await page.getByRole('button', { name: 'Add Expense' }).last().click();

    await expect(page.getByRole('alert').filter({ hasText: 'amount above 0' })).toBeVisible();
    await expect(page.locator('#expense-amount')).toBeVisible();
  });

  test('a start date after the end date shows a message and does not call the server', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);

    await fillRange(page, '2026-03-10', '2026-03-01');

    await expect(page.getByTestId('expense-filter-error')).toContainText('must not be after');
  });

  test('the category filter shows only that category', async ({ api, signIn }) => {
    const day = quietDay();
    await create(api, day, RENT, 100);
    await create(api, day, UTILITIES, 40);
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);
    await filterTo(page, day, day);
    await expect(page.getByTestId('expense-row')).toHaveCount(2);

    await openFilters(page);
    await page.locator('#expense-filter-category').selectOption({ label: 'Utilities' });
    await expect(page.getByRole('button', { name: 'Filters, 2 applied' })).toBeVisible();
    await closeFilters(page);

    await expect(page.getByTestId('expense-row')).toHaveCount(1);
    await expect(page.getByTestId('expense-total')).toContainText('40.00');

    await openFilters(page);
    await page.getByTestId('clear-expense-category').click();
    await closeFilters(page);
    await expect(page.getByTestId('expense-row')).toHaveCount(2);
  });

  test('the admin viewer sees the expenses with no buttons to change them', async ({ api, signIn }) => {
    const day = quietDay();
    await create(api, day, RENT, 100, 'Viewer sees me');
    const page = await signIn('viewer');
    await page.goto(ROUTES.expenses);
    await filterTo(page, day, day);

    await expect(page.getByTestId('expense-row')).toContainText('Viewer sees me');
    await expect(page.getByTestId('add-expense')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expense actions' })).toHaveCount(0);
  });

  for (const role of ['cashier', 'stockmgr', 'itemmgr'] as const) {
    test(`${role} cannot open the page`, async ({ signIn }) => {
      const page = await signIn(role);
      await page.goto(ROUTES.expenses);

      await expect(page).not.toHaveURL(/\/management\/expenses$/);
    });
  }

  test('a long note and a huge amount wrap and stay inside the card at every width, in both styles', async ({ api, signIn }) => {
    const day = quietDay();
    await create(api, day, RENT, 99999999.99, `${'Long'.repeat(20)} ${'W'.repeat(100)}`);
    const page = await signIn('admin');
    await page.goto(ROUTES.expenses);

    for (const style of ['light', 'cafe'] as const) {
      await useStyle(page, style);
      await page.reload();
      await filterTo(page, day, day);
      await expect(page.getByTestId('expense-row')).toHaveCount(1);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(page.getByTestId('expense-row')).toBeVisible();
        expect(overflowProblem(await measureOverflow(page)), `${style} / ${viewport.name}`).toBeNull();
      }
    }
  });

  test('the dialog fits a phone', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(ROUTES.expenses);

    await page.getByTestId('add-expense').click();

    await expect(page.locator('#expense-note')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Expense' }).last()).toBeInViewport();
    expect(overflowProblem(await measureOverflow(page))).toBeNull();
  });
});
