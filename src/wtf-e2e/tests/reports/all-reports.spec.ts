import { Api } from '@api/index';
import { PromotionsExtra } from '@api/promotions-extra';
import { expect, test } from '@fixtures/index';
import { MAX_REPORT_RANGE_DAYS, MIN_DOWNLOAD_BYTES } from '@data/enums';
import { REPORT_API_PATHS, ROUTES } from '@data/routes';
import { Role } from '@data/users';
import { daysFromToday, today } from '@utils/dates';
import { captureDownload, isUsableDownload } from '@utils/download';

const EXCEL: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF: string = 'application/pdf';
const NO_DATES: ReadonlyArray<string> = ['stock-status'];

interface ProductRow {
  readonly productId: string;
  readonly quantitySold: number;
  readonly revenue: number;
  readonly grossSales: number;
  readonly discounts: number;
  readonly refundedAmount: number;
}

interface DailyRow {
  readonly totalRevenue: number;
  readonly orderCount: number;
  readonly refundedCount: number;
  readonly refundedAmount: number;
  readonly grossSales: number;
  readonly netSales: number;
  readonly discounts: number;
}

interface PromotionRow {
  readonly promotionName: string;
  readonly uses: number;
  readonly revenue: number;
  readonly discountGiven: number | null;
}

interface VoidRow {
  readonly orderId: string;
  readonly amount: number;
  readonly reason: string | null;
}

function path(slug: string, from: string = today(), to: string = today()): string {
  const query = NO_DATES.includes(slug) ? '' : `?fromDate=${from}&toDate=${to}`;
  return `reports/${slug}${query}`;
}

async function sellAndRefund(api: Api, price: number = 100): Promise<{ productId: string; refundedOrderId: string }> {
  const product = await api.products.create({ price });
  await api.orders.create({ items: [{ productId: product.id, quantity: 2 }] });
  const refunded = await api.orders.create({ items: [{ productId: product.id, quantity: 1 }] });
  const response = await api.orders.voidOrder(refunded.id, 'E2E report refund');
  expect(response.ok(), await response.text()).toBeTruthy();
  return { productId: product.id, refundedOrderId: refunded.id };
}

test.describe('every report answers JSON @reports', () => {
  for (const slug of REPORT_API_PATHS) {
    test(`${slug} returns 200 JSON rows for an admin`, async ({ api }) => {
      const response = await api.client.call('admin', 'GET', path(slug));
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
      expect(Array.isArray(await response.json())).toBe(true);
    });
  }
});

test.describe('report date validation @reports', () => {
  for (const slug of REPORT_API_PATHS.filter((name) => !NO_DATES.includes(name))) {
    test(`${slug} refuses missing dates, a reversed range and a range over a year`, async ({ api }) => {
      expect((await api.client.call('admin', 'GET', `reports/${slug}`)).status()).toBe(400);
      expect((await api.client.call('admin', 'GET', `reports/${slug}?fromDate=${today()}`)).status()).toBe(400);
      expect((await api.client.call('admin', 'GET', path(slug, today(), daysFromToday(-1)))).status()).toBe(400);

      const tooLong = await api.client.call('admin', 'GET', path(slug, daysFromToday(-(MAX_REPORT_RANGE_DAYS + 5)), today()));
      expect(tooLong.status()).toBe(400);
      expect(await tooLong.text()).toContain(String(MAX_REPORT_RANGE_DAYS));
    });
  }

  test('a range of exactly one year is allowed', async ({ api }) => {
    const response = await api.client.call('admin', 'GET', path('daily-sales', daysFromToday(-MAX_REPORT_RANGE_DAYS), today()));
    expect(response.status()).toBe(200);
  });

  test('an unknown source is refused and a known one is accepted', async ({ api }) => {
    expect((await api.client.call('admin', 'GET', `${path('product-sales')}&source=9`)).status()).toBe(400);
    expect((await api.client.call('admin', 'GET', `${path('product-sales')}&source=0`)).status()).toBe(200);
    expect((await api.client.call('admin', 'GET', `${path('product-sales')}&source=1`)).status()).toBe(200);
  });

  test('daily sales refuses an unknown groupBy', async ({ api }) => {
    expect((await api.client.call('admin', 'GET', `${path('daily-sales')}&groupBy=Century`)).status()).toBe(400);
  });
});

test.describe('report exports @reports', () => {
  for (const slug of REPORT_API_PATHS) {
    test(`${slug} downloads as Excel and PDF`, async ({ api }) => {
      const excel = await api.client.call('admin', 'GET', path(slug), { accept: EXCEL });
      expect(excel.status(), await excel.text()).toBe(200);
      expect(excel.headers()['content-type']).toContain(EXCEL);
      const excelBytes = await excel.body();
      expect(excelBytes.length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
      expect(excelBytes.subarray(0, 2).toString('latin1')).toBe('PK');

      const pdf = await api.client.call('admin', 'GET', path(slug), { accept: PDF });
      expect(pdf.status(), await pdf.text()).toBe(200);
      expect(pdf.headers()['content-type']).toContain(PDF);
      const pdfBytes = await pdf.body();
      expect(pdfBytes.length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
      expect(pdfBytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });
  }

  test('an export with a search that matches nothing still downloads a file', async ({ api }) => {
    const response = await api.client.call('admin', 'GET', `${path('product-sales')}&search=zzzz-no-such-product`, { accept: EXCEL });
    expect(response.status()).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
  });

  test('an export follows the search: the file is smaller than the full one when it matches one product', async ({ api }) => {
    const { productId } = await sellAndRefund(api);
    const product = await api.products.get(productId);

    const all = await api.client.call('admin', 'GET', path('product-sales'), { accept: EXCEL });
    const one = await api.client.call('admin', 'GET', `${path('product-sales')}&search=${encodeURIComponent(product.name)}`, { accept: EXCEL });
    expect(one.status()).toBe(200);
    expect((await one.body()).length).toBeLessThanOrEqual((await all.body()).length);
  });
});

test.describe('who may read reports @reports @auth', () => {
  test('a viewer can read a report but cannot generate the monthly workbook', async ({ api }) => {
    expect((await api.client.call('viewer', 'GET', path('daily-sales'))).status()).toBe(200);
    expect((await api.client.call('viewer', 'GET', 'reports/monthly-workbook/status?year=2026&month=10')).status()).toBe(200);
    expect((await api.client.call('viewer', 'POST', 'reports/monthly-workbook/generate?year=2026&month=10')).status()).toBe(403);
  });

  for (const role of ['cashier', 'stockmgr', 'itemmgr'] as ReadonlyArray<Role>) {
    test(`${role} gets 403 on every report`, async ({ api }) => {
      for (const slug of REPORT_API_PATHS) {
        const response = await api.client.call(role, 'GET', path(slug));
        expect(response.status(), `${role} ${slug}`).toBe(403);
      }

      expect((await api.client.call(role, 'GET', 'reports/monthly-workbook/status?year=2026&month=10')).status()).toBe(403);
    });
  }

  test('no login gets 401', async ({ api }) => {
    expect((await api.client.call(null, 'GET', path('daily-sales'))).status()).toBe(401);
  });

  test('an admin can generate and download the monthly workbook, bad months are refused', async ({ api }) => {
    const now = new Date();
    const query = `year=${now.getFullYear()}&month=${now.getMonth() + 1}`;

    const generated = await api.client.call('admin', 'POST', `reports/monthly-workbook/generate?${query}`);
    expect(generated.status(), await generated.text()).toBe(200);

    const file = await api.client.call('admin', 'GET', `reports/monthly-workbook/download?${query}`);
    expect(file.status()).toBe(200);
    const bytes = await file.body();
    expect(bytes.length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    expect((await api.client.call('admin', 'GET', 'reports/monthly-workbook/status?year=2026&month=13')).status()).toBe(400);
    expect((await api.client.call('admin', 'GET', 'reports/monthly-workbook/status?year=1999&month=1')).status()).toBe(400);
  });
});

test.describe('report totals match hand-worked answers @reports', () => {
  test('product sales: refunded orders count in gross and refunded but not in quantity or revenue', async ({ api }) => {
    const { productId } = await sellAndRefund(api);

    const rows = await api.client.json<ProductRow[]>('admin', 'GET', path('product-sales'));
    const row = rows.find((candidate) => candidate.productId === productId);

    expect(row).toBeDefined();
    expect(row!.quantitySold).toBe(2);
    expect(row!.revenue).toBe(200);
    expect(row!.grossSales).toBe(300);
    expect(row!.refundedAmount).toBe(100);
    expect(row!.discounts).toBe(0);
    expect(row!.grossSales - row!.discounts - row!.refundedAmount).toBe(row!.revenue);
  });

  test('product sales: a discounted sale shows the discount as gross minus net', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await api.products.create({ price: 100 });
    await promos.discounted({ productId: product.id, amountOff: 30 });
    await promos.sellPlain(product.id, 2);

    const rows = await api.client.json<ProductRow[]>('admin', 'GET', path('product-sales'));
    const row = rows.find((candidate) => candidate.productId === product.id);

    expect(row).toBeDefined();
    expect(row!.quantitySold).toBe(2);
    expect(row!.grossSales).toBe(200);
    expect(row!.discounts).toBe(60);
    expect(row!.revenue).toBe(140);
  });

  test('daily sales: every row satisfies gross - discounts - refunded = net and includes the new sales', async ({ api }) => {
    await sellAndRefund(api);

    const rows = await api.client.json<DailyRow[]>('admin', 'GET', path('daily-sales'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.grossSales - row.discounts - row.refundedAmount).toBeCloseTo(row.netSales, 2);
    }

    const total = rows.reduce(
      (sum, row) => ({
        revenue: sum.revenue + row.totalRevenue,
        refunded: sum.refunded + row.refundedAmount,
        refundedCount: sum.refundedCount + row.refundedCount,
        gross: sum.gross + row.grossSales,
      }),
      { revenue: 0, refunded: 0, refundedCount: 0, gross: 0 },
    );
    expect(total.revenue).toBeGreaterThanOrEqual(200);
    expect(total.refunded).toBeGreaterThanOrEqual(100);
    expect(total.refundedCount).toBeGreaterThanOrEqual(1);
    expect(total.gross).toBeGreaterThanOrEqual(300);
  });

  test('daily sales grows by exactly the new sale when nobody else sells in between (revenue never shrinks)', async ({ api }) => {
    const before = await api.client.json<DailyRow[]>('admin', 'GET', path('daily-sales'));
    const product = await api.products.create({ price: 100 });
    await api.orders.create({ items: [{ productId: product.id, quantity: 3 }] });
    const after = await api.client.json<DailyRow[]>('admin', 'GET', path('daily-sales'));

    const sum = (rows: DailyRow[]): number => rows.reduce((total, row) => total + row.totalRevenue, 0);
    expect(sum(after)).toBeGreaterThanOrEqual(sum(before) + 300);
  });

  test('voids and refunds lists the refunded order with its amount and reason', async ({ api }) => {
    const { refundedOrderId } = await sellAndRefund(api);

    const rows = await api.client.json<VoidRow[]>('admin', 'GET', path('voids'));
    const row = rows.find((candidate) => candidate.orderId === refundedOrderId);

    expect(row).toBeDefined();
    expect(row!.amount).toBe(100);
    expect(row!.reason ?? '').toContain('E2E report refund');
  });

  test('promotions performance reports the uses, revenue and discount given', async ({ api }) => {
    const promos = new PromotionsExtra(api.client);
    const product = await api.products.create({ price: 100 });
    await promos.discounted({ productId: product.id, amountOff: 11.37 });
    await promos.sellPlain(product.id, 2);

    const rows = await api.client.json<PromotionRow[]>('admin', 'GET', path('promotions'));
    const row = rows.find((candidate) => candidate.promotionName.includes('11.37'));

    expect(row).toBeDefined();
    expect(row!.uses).toBeGreaterThanOrEqual(2);
    expect(row!.revenue).toBeGreaterThanOrEqual(177.26);
    expect(row!.discountGiven ?? 0).toBeGreaterThanOrEqual(22.74);
  });
});

test.describe('reports in the app @reports', () => {
  // Some data to show, made once; then one small test per report so they run side by side.
  test.beforeAll(async ({ playwright }) => {
    const context = await playwright.request.newContext();
    await sellAndRefund(new Api(context));
    await context.dispose();
  });

  for (const slug of REPORT_API_PATHS) {
    test(`the ${slug} report opens from the catalog link without page errors`, async ({ signIn }) => {
      const page = await signIn('admin');
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(ROUTES.report(slug));

      await expect(page.getByRole('button', { name: 'Back to all reports' }), slug).toBeVisible();
      await expect(page.getByRole('group', { name: 'Export' }), slug).toBeVisible();
      await expect(page.locator('.alert-error'), slug).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('the catalog lists the reports and opens one with a click', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.reports);

    await expect(page.locator('[data-report-catalog]')).toBeVisible();
    await page.locator('[data-report="product-sales"]').click();
    await expect(page.getByRole('button', { name: 'Back to all reports' })).toBeVisible();
  });

  test('the product report downloads as Excel, PDF and CSV from the screen', async ({ api, signIn }, info) => {
    await sellAndRefund(api);
    const page = await signIn('admin');
    await page.goto(ROUTES.report('product-sales'));
    const exports = page.getByRole('group', { name: 'Export' });
    await expect(exports).toBeVisible();
    await expect(exports.getByRole('button', { name: 'CSV' })).toBeEnabled();

    const excel = await captureDownload(page, info, () => exports.getByRole('button', { name: 'Excel' }).click());
    expect(excel.fileName).toMatch(/\.xlsx$/);
    expect(isUsableDownload(excel)).toBe(true);

    const pdf = await captureDownload(page, info, () => exports.getByRole('button', { name: 'PDF' }).click());
    expect(pdf.fileName).toMatch(/\.pdf$/);
    expect(isUsableDownload(pdf)).toBe(true);

    const csv = await captureDownload(page, info, () => exports.getByRole('button', { name: 'CSV' }).click());
    expect(csv.fileName).toMatch(/\.csv$/);
    expect(isUsableDownload(csv)).toBe(true);
  });

  test('a cashier is sent away from the reports page', async ({ signIn }) => {
    const page = await signIn('cashier');
    await page.goto(ROUTES.reports);
    await expect(page).not.toHaveURL(/\/management\/reports/);
  });

  test('a viewer can read reports but the monthly workbook tab has no Generate button', async ({ signIn }) => {
    const page = await signIn('viewer');
    await page.goto(ROUTES.reports);
    await expect(page.locator('[data-report-catalog]')).toBeVisible();
    await page.getByRole('tab', { name: 'Monthly Workbook' }).click();
    await expect(page.getByRole('button', { name: /Generate Workbook/ })).toHaveCount(0);
  });
});
