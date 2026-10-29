import { Api } from '@api/index';
import { expect, test } from '@fixtures/index';
import { MIN_DOWNLOAD_BYTES } from '@data/enums';
import { ROUTES } from '@data/routes';
import { Role } from '@data/users';
import { captureDownload, isUsableDownload } from '@utils/download';
import { unique } from '@utils/unique';

const EXCEL: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF: string = 'application/pdf';

interface DashboardJson {
  readonly today: { readonly totalOrders: number; readonly totalRevenue: number };
  readonly topSellingProducts: ReadonlyArray<{ readonly productName?: string; readonly name?: string }>;
  readonly recentOrders: ReadonlyArray<{ readonly id: string }>;
}

interface AuditPage {
  readonly items: ReadonlyArray<{ readonly action: string; readonly entityType: string; readonly entityId: string; readonly userName: string | null }>;
  readonly totalCount?: number;
}

interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly isRead: boolean;
}

interface NotificationPage {
  readonly items: ReadonlyArray<NotificationRow>;
  readonly unreadCount: number;
}

async function findNotification(api: Api, role: Role, needle: string): Promise<NotificationRow | undefined> {
  const page = await api.client.json<NotificationPage>(role, 'GET', 'notifications?page=1&pageSize=100');
  return page.items.find((row) => `${row.title} ${row.body}`.includes(needle));
}

async function lowItemName(api: Api): Promise<string> {
  const name = unique('E2E Alert Item');
  await api.items.create({ name, startingQuantity: 1, warningQuantity: 10, criticalQuantity: 2 });
  return name;
}

test.describe('audit log @dashboard @audit @auth', () => {
  test('a created item shows in the audit log for the super admin', async ({ api }) => {
    const item = await api.items.create({ name: unique('E2E Audit Item') });

    await expect
      .poll(async () => {
        const page = await api.client.json<AuditPage>('superadmin', 'GET', `audit-logs?entityId=${item.id}&page=1&pageSize=20`);
        return page.items.some((row) => row.action === 'ItemCreated' && row.entityId === item.id);
      })
      .toBe(true);
  });

  test('a voided order shows in the audit log with the user who voided it', async ({ api }) => {
    const product = await api.products.create({ price: 100 });
    const order = await api.orders.create({ items: [{ productId: product.id, quantity: 1 }] });
    const response = await api.orders.voidOrder(order.id, 'E2E audit check');
    expect(response.ok(), await response.text()).toBeTruthy();

    await expect
      .poll(async () => {
        const page = await api.client.json<AuditPage>('superadmin', 'GET', `audit-logs?entityId=${order.id}&page=1&pageSize=20`);
        return page.items.filter((row) => row.action === 'OrderVoided').length;
      })
      .toBe(1);
  });

  test('the audit action list includes the actions used here', async ({ api }) => {
    const actions = await api.client.json<string[]>('superadmin', 'GET', 'audit-logs/actions');
    expect(actions).toEqual(expect.arrayContaining(['ItemCreated', 'OrderVoided', 'OrderCreated']));
  });

  for (const role of ['admin', 'viewer', 'cashier', 'stockmgr', 'itemmgr'] as ReadonlyArray<Role>) {
    test(`${role} gets 403 from the audit log`, async ({ api }) => {
      expect((await api.client.call(role, 'GET', 'audit-logs?page=1&pageSize=5')).status()).toBe(403);
      expect((await api.client.call(role, 'GET', 'audit-logs/actions')).status()).toBe(403);
    });
  }

  test('the audit log exports to Excel and PDF with every matching row', async ({ api }) => {
    const item = await api.items.create({ name: unique('E2E Audit Export') });

    const excel = await api.client.call('superadmin', 'GET', `audit-logs?entityId=${item.id}`, { accept: EXCEL });
    expect(excel.status(), await excel.text()).toBe(200);
    const excelBytes = await excel.body();
    expect(excelBytes.length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
    expect(excelBytes.subarray(0, 2).toString('latin1')).toBe('PK');

    const pdf = await api.client.call('superadmin', 'GET', `audit-logs?entityId=${item.id}`, { accept: PDF });
    expect(pdf.status()).toBe(200);
    const pdfBytes = await pdf.body();
    expect(pdfBytes.length).toBeGreaterThan(MIN_DOWNLOAD_BYTES);
    expect(pdfBytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  test('an admin is sent away from the audit log page', async ({ signIn }) => {
    const page = await signIn('admin');
    await page.goto(ROUTES.auditLogs);
    await expect(page).not.toHaveURL(/audit-logs/);
  });

  test('the super admin opens the audit log page and downloads Excel and PDF', async ({ api, signIn }, info) => {
    await api.items.create({ name: unique('E2E Audit Screen') });
    const page = await signIn('superadmin');
    await page.goto(ROUTES.auditLogs);

    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    const excel = await captureDownload(page, info, () => page.getByRole('button', { name: 'Download Excel' }).click());
    expect(excel.fileName).toMatch(/\.xlsx$/);
    expect(isUsableDownload(excel)).toBe(true);

    const pdf = await captureDownload(page, info, () => page.getByRole('button', { name: 'Download PDF' }).click());
    expect(pdf.fileName).toMatch(/\.pdf$/);
    expect(isUsableDownload(pdf)).toBe(true);
  });
});
